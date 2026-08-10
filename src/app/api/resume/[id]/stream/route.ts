export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getQueue } from "@/lib/sse-queue";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const q = getQueue(id);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      // 1) Drain anything already queued (happens if processing already finished
      //    before the client connected)
      const initial = q.drain();
      for (const item of initial) {
        send("progress", item);
      }
      if (q.isDone()) {
        send("done", { status: "completed" });
        controller.close();
        return;
      }

      // 2) Keep-alive / poll loop — new ReadableStream so we can yield to the
      //    event loop without blocking.
      const KEEP_ALIVE = 30_000; // send a comment every 30s to prevent proxy timeouts

      const poll = async () => {
        const batch = q.drain();
        for (const item of batch) {
          send("progress", item);
        }
        if (q.isDone()) {
          send("done", { status: "completed" });
          controller.close();
          return;
        }
        setTimeout(poll, 250);
      };

      // Kick off the polling loop
      const pollHandle = setTimeout(poll, 50);

      // Periodic no-op comment to keep reverse-proxy connections alive
      const kaHandle = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch { /* connection already closed */ }
      }, KEEP_ALIVE);

      // Clean up on abort
      if (_request.signal) {
        _request.signal.addEventListener("abort", () => {
          clearTimeout(pollHandle);
          clearInterval(kaHandle);
          try {
            controller.close();
          } catch { /* already closed */ }
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
