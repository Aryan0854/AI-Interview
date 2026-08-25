"use client";

import { useEffect, useRef } from "react";
import "plyr/dist/plyr.css";

export type PlyrCaptionTrack = {
  src: string;
  label?: string;
  srclang?: string;
  default?: boolean;
};

type PlyrInstance = {
  play: () => Promise<void> | void;
  destroy: () => void;
  on: (event: string, callback: () => void) => void;
  off: (event: string, callback: () => void) => void;
};

type PlyrVideoPlayerProps = {
  src: string;
  title?: string;
  autoPlay?: boolean;
  className?: string;
  poster?: string;
  captionTracks?: PlyrCaptionTrack[];
  onError?: () => void;
  onReady?: () => void;
};

export default function PlyrVideoPlayer({
  src,
  title,
  autoPlay = false,
  className,
  poster,
  captionTracks,
  onError,
  onReady,
}: PlyrVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<PlyrInstance | null>(null);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  }, [onError, onReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let player: PlyrInstance | null = null;

    const handleReady = () => {
      onReadyRef.current?.();
      if (autoPlay) {
        void player?.play()?.catch(() => {});
      }
    };

    const handleError = () => {
      onErrorRef.current?.();
    };

    void (async () => {
      const { default: PlyrConstructor } = await import("plyr");
      if (cancelled || !videoRef.current) return;

      player = new PlyrConstructor(videoRef.current, {
        controls: [
          "play-large",
          "play",
          "progress",
          "current-time",
          "duration",
          "mute",
          "volume",
          "captions",
          "settings",
          "pip",
          "airplay",
          "fullscreen",
        ],
        settings: ["captions", "speed"],
        speed: {
          selected: 1,
          options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        },
        tooltips: {
          controls: true,
          seek: true,
        },
        keyboard: {
          focused: true,
          global: false,
        },
        hideControls: true,
        resetOnEnd: false,
        autoplay: autoPlay,
        clickToPlay: true,
        iconUrl: "/plyr.svg",
        invertTime: false,
        toggleInvert: false,
        i18n: {
          play: "Play",
          pause: "Pause",
          currentTime: "Current time",
          duration: "Duration",
          mute: "Mute",
          unmute: "Unmute",
          enableCaptions: "Enable captions",
          disableCaptions: "Disable captions",
          enterFullscreen: "Enter fullscreen",
          exitFullscreen: "Exit fullscreen",
          settings: "Settings",
          speed: "Speed",
          normal: "Normal",
          pip: "Picture in picture",
        },
      }) as PlyrInstance;

      if (cancelled) {
        player.destroy();
        return;
      }

      playerRef.current = player;
      player.on("ready", handleReady);
      videoRef.current.addEventListener("error", handleError);
    })();

    return () => {
      cancelled = true;
      if (player) {
        player.off("ready", handleReady);
        player.destroy();
        playerRef.current = null;
      }
      video.removeEventListener("error", handleError);
    };
  }, [autoPlay]);

  useEffect(() => {
    const video = videoRef.current;
    const player = playerRef.current;
    if (!video || !src) return;
    if (video.getAttribute("src") === src) return;
    video.src = src;
    video.load();
    if (autoPlay && player) {
      void player.play()?.catch(() => {});
    }
  }, [src, autoPlay]);

  return (
    <div
      className={`plyr-video-player w-full ${className ?? ""}`}
      data-title={title}
    >
      <video
        ref={videoRef}
        src={src}
        className="plyr-video-player__media"
        playsInline
        preload="auto"
        poster={poster}
      >
        {captionTracks?.map((track) => (
          <track
            key={track.src}
            kind="captions"
            src={track.src}
            label={track.label ?? "Captions"}
            srcLang={track.srclang ?? "en"}
            default={track.default}
          />
        ))}
      </video>
    </div>
  );
}
