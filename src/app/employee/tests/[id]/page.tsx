import TestRunnerClient from "./TestRunnerClient";

export default async function TestRunner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <TestRunnerClient testId={id} />;
}
