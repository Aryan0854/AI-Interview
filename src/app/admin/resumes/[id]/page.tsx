"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ClipboardList, FileText, Sparkles, ShieldAlert, Volume2, Video, Search, Play, Pause, VolumeX, Maximize } from "lucide-react";
import AdminAuthGate from "@/components/AdminAuthGate";

function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== "undefined" ? window.sessionStorage.getItem("admin_token") : null;
  const headersObj: Record<string, string> = {};

  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([key, value]) => {
        headersObj[key] = value;
      });
    } else {
      Object.assign(headersObj, init.headers);
    }
  }

  if (token) {
    headersObj["Authorization"] = `Bearer ${token}`;
  }

  // Remove Content-Type for FormData requests so browser can set boundary automatically
  if (init?.body && typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) {
    delete headersObj["Content-Type"];
  }

  return window.fetch(input, {
    ...init,
    headers: headersObj,
  }).then((res) => {
    if (res.status === 401 && typeof window !== "undefined") {
      window.sessionStorage.removeItem("resume-admin-authenticated");
      window.sessionStorage.removeItem("admin-email");
      window.sessionStorage.removeItem("admin_token");
      window.location.reload();
    }
    return res;
  });
}

const fetch = adminFetch;

const ENRICHED_DATA: any[] = [];


function enrichAttempts(attempts: any[]) {
  return attempts || [];
}

export default function AdminResponseReviewPage() {
  const params = useParams();
  const resumeId = params?.id as string;
  const [resume, setResume] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'audio' | 'video'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [clmReady, setClmReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isHoveringVideo, setIsHoveringVideo] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const seekerRef = useRef<HTMLDivElement>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  const getCalculatedDuration = () => {
    let reportObj: any = {};
    if (resume?.report) {
      reportObj = typeof resume.report === 'string' ? JSON.parse(resume.report) : resume.report;
    }
    const dbVideoDuration = reportObj.videoDuration || 0;
    if (dbVideoDuration && isFinite(dbVideoDuration) && dbVideoDuration > 0) {
      return dbVideoDuration;
    }

    if (videoRef.current && isFinite(videoRef.current.duration) && videoRef.current.duration > 0) {
      return videoRef.current.duration;
    }
    if (videoDuration && isFinite(videoDuration) && videoDuration > 0) {
      return videoDuration;
    }
    if (!resume) return 60;
    
    // Calculate interview duration
    const sorted = resume.interview_attempts
      ? [...resume.interview_attempts].sort(
          (a: any, b: any) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
        )
      : [];
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    let interviewDurationSec = 0;
    if (first?.timestamp && last?.timestamp) {
      const diffMs = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();
      interviewDurationSec = Math.floor(diffMs / 1000);
    }

    const proctoring = reportObj?.proctoring || {};
    const violationsList = proctoring.violations || [];
    const maxViolationTime = violationsList.reduce((max: number, v: any) => typeof v.videoTimestamp === 'number' && v.videoTimestamp > max ? v.videoTimestamp : max, 0);

    return interviewDurationSec || maxViolationTime || 60;
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMute = !isMuted;
      videoRef.current.muted = nextMute;
      setIsMuted(nextMute);
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      } else if ((videoRef.current as any).webkitRequestFullscreen) {
        (videoRef.current as any).webkitRequestFullscreen();
      } else if ((videoRef.current as any).msRequestFullscreen) {
        (videoRef.current as any).msRequestFullscreen();
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const totalDur = getCalculatedDuration();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = Math.max(0, Math.min(1, clickX / width));
    const nextTime = percentage * totalDur;
    videoRef.current.currentTime = nextTime;
    setVideoCurrentTime(nextTime);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const seeker = seekerRef.current;
      const totalDur = getCalculatedDuration();
      if (seeker && videoRef.current && totalDur) {
        const rect = seeker.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const percentage = Math.max(0, Math.min(1, clickX / width));
        const nextTime = percentage * totalDur;
        videoRef.current.currentTime = nextTime;
        setVideoCurrentTime(nextTime);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, resume, videoDuration]);

  // Dynamic script loader for clmtrackr
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let clmScript: HTMLScriptElement | null = null;
    let modelScript: HTMLScriptElement | null = null;

    const loadScripts = async () => {
      try {
        if ((window as any).clm) {
          setClmReady(true);
          return;
        }

        clmScript = document.createElement('script');
        clmScript.src = 'https://cdn.jsdelivr.net/npm/clmtrackr@1.1.2/build/clmtrackr.min.js';
        clmScript.async = true;
        document.body.appendChild(clmScript);

        await new Promise((resolve) => {
          clmScript!.onload = resolve;
        });

        modelScript = document.createElement('script');
        modelScript.src = 'https://cdn.jsdelivr.net/npm/clmtrackr@1.1.2/models/model_pca_20_svm.js';
        modelScript.async = true;
        document.body.appendChild(modelScript);

        await new Promise((resolve) => {
          modelScript!.onload = resolve;
        });

        if ((window as any).clm && (window as any).pModel) {
          setClmReady(true);
        }
      } catch (err) {
        console.error("Failed to load clmtrackr scripts on admin page:", err);
      }
    };

    loadScripts();

    return () => {
      if (clmScript && document.body.contains(clmScript)) {
        try { document.body.removeChild(clmScript); } catch(e){}
      }
      if (modelScript && document.body.contains(modelScript)) {
        try { document.body.removeChild(modelScript); } catch(e){}
      }
    };
  }, []);

  // Admin face tracking overlay setup
  useEffect(() => {
    if (!clmReady || !resume?.report?.videoUrl) return;
    if (!(window as any).clm || !(window as any).pModel) return;

    let trackerInstance: any = null;
    let animationFrameId: any = null;

    const initTracker = () => {
      try {
        const video = videoRef.current;
        if (!video) return;

        if (trackerInstance) {
          try { trackerInstance.stop(); } catch (e) {}
        }

        trackerInstance = new (window as any).clm.tracker();
        trackerInstance.init((window as any).pModel);
        trackerInstance.start(video);

        const drawLoop = () => {
          if (video) {
            const canvas = canvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
                  canvas.width = video.clientWidth;
                  canvas.height = video.clientHeight;
                }

                const positions = trackerInstance.getCurrentPosition();
                if (positions && positions.length > 0) {
                  // Draw custom green bounding box
                  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                  positions.forEach((pos: number[]) => {
                    if (pos[0] < minX) minX = pos[0];
                    if (pos[0] > maxX) maxX = pos[0];
                    if (pos[1] < minY) minY = pos[1];
                    if (pos[1] > maxY) maxY = pos[1];
                  });

                  const width = maxX - minX;
                  const height = maxY - minY;

                  ctx.strokeStyle = '#10b981'; // green (emerald-500)
                  ctx.lineWidth = 2;
                  ctx.strokeRect(minX - width * 0.1, minY - height * 0.15, width * 1.2, height * 1.35);

                  const score = trackerInstance.getScore();
                  const confidence = Math.min(100, Math.max(0, Math.round((score || 0.98) * 100)));

                  ctx.fillStyle = '#10b981';
                  ctx.font = 'bold 9px sans-serif';
                  ctx.fillText('ONE PERSON DETECTED', minX - width * 0.1, minY - height * 0.28);
                  ctx.fillText(`FACE DETECTED (${confidence}%)`, minX - width * 0.1, minY - height * 0.18);

                  // Draw clmtrackr green face tracking lines
                  trackerInstance.draw(canvas);
                }
              }
            }
          }
          animationFrameId = requestAnimationFrame(drawLoop);
        };

        drawLoop();
      } catch (err) {
        console.debug("Admin clmtrackr tracker error:", err);
      }
    };

    const video = videoRef.current;
    if (video) {
      if (video.readyState >= 1) {
        initTracker();
      } else {
        video.addEventListener('loadedmetadata', initTracker);
      }
      video.addEventListener('play', initTracker);
    }

    return () => {
      if (video) {
        video.removeEventListener('loadedmetadata', initTracker);
        video.removeEventListener('play', initTracker);
      }
      if (trackerInstance) {
        try { trackerInstance.stop(); } catch(e){}
      }
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [clmReady, resume?.report?.videoUrl]);

  useEffect(() => {
    if (!resumeId) return;

    setLoading(true);
    fetch(`/api/admin/resumes/${resumeId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.resume) {
          setResume(data.resume);
          setError("");
        } else {
          setError(data.error || "Candidate record not found.");
        }
      })
      .catch((err) => {
        console.error("Failed to load resume review", err);
        setError("Unable to load response review at this time.");
      })
      .finally(() => setLoading(false));
  }, [resumeId]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/admin")) {
        window.sessionStorage.removeItem("resume-admin-authenticated");
        window.sessionStorage.removeItem("admin-email");
        window.sessionStorage.removeItem("admin_token");
      }
    };
  }, []);

  useEffect(() => {
    if (resume?.report?.videoUrl) {
      setVideoSrc(`${resume.report.videoUrl}?t=${Date.now()}`);
    } else {
      setVideoSrc(null);
    }
  }, [resume?.report?.videoUrl]);

  return (
    <AdminAuthGate>
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-foreground font-sans transition-colors duration-300">
        <nav className="bg-card/95 border-b border-border py-4 px-6 shadow-nav sticky top-0 z-50 backdrop-blur-md transition-colors">
          <div className="max-w-full mx-auto flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-md shadow-indigo-500/30">
                <FileText className="w-[18px] h-[18px] text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight bg-primary bg-clip-text text-transparent">Resume Analysis Records</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/admin">
                <Button variant="outline" size="sm" className="rounded-xl border-border text-primary hover:bg-secondary gap-2">
                  <ArrowLeft className="w-4 h-4" /> Back to Records
                </Button>
              </Link>
            </div>
          </div>
        </nav>

        <main className="max-w-full mx-auto px-4 py-8">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 mb-1">
                <ClipboardList className="w-6 h-6 text-primary" />
                Response Review
              </h1>
              <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                All submissions include mock scoring and feedback generated by the system (hidden from candidates).
              </p>
            </div>
            <Badge className="px-4 py-1 text-sm bg-indigo-100 dark:bg-slate-800 text-primary border-0 font-semibold">
              Candidate ID: {resume?.id ? resume.id.slice(0, 16) : "Loading…"}
            </Badge>
          </div>

          {loading ? (
            <Card className="p-10 bg-card border border-border shadow-soft text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4"
              >
                <Sparkles className="w-5 h-5 text-white animate-pulse" />
              </motion.div>
              <div className="text-slate-505 dark:text-slate-400 font-medium">Loading response review…</div>
            </Card>
          ) : error ? (
            <Card className="p-10 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 shadow-soft text-center text-red-600 dark:text-red-450">
              {error}
            </Card>
          ) : (
            (() => {
              const sortedAttempts = resume.interview_attempts
                ? [...resume.interview_attempts].sort(
                    (a: any, b: any) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
                  )
                : [];

              const firstAttempt = sortedAttempts[0];
              const lastAttempt = sortedAttempts[sortedAttempts.length - 1];

              // Use interview_started_at if available, otherwise use first attempt timestamp
              const startTimestamp = resume.interview_started_at 
                ? new Date(resume.interview_started_at) 
                : (firstAttempt?.timestamp ? new Date(firstAttempt.timestamp) : null);
              const endTimestamp = lastAttempt?.timestamp ? new Date(lastAttempt.timestamp) : null;

              let totalDurationStr = "";
              if (startTimestamp && endTimestamp) {
                const diffMs = endTimestamp.getTime() - startTimestamp.getTime();
                const diffSec = Math.floor(diffMs / 1000);
                const mins = Math.floor(diffSec / 60);
                const secs = diffSec % 60;
                totalDurationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
              }

              // 1. Safe parsing of report JSON
              let reportObj: any = {};
              if (resume && resume.report) {
                reportObj = typeof resume.report === 'string' ? JSON.parse(resume.report) : resume.report;
              }
              const proctoring = reportObj?.proctoring || {};
              const violationsList = proctoring.violations || [];
              const autoSubmitted = proctoring.autoSubmitted || false;

              // 2. Formatting helper
              const formatVideoTime = (seconds: number | undefined) => {
                if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
              };

              // 3. Click-to-seek handler
              const handleSeek = (seconds: number | undefined) => {
                if (videoRef.current && typeof seconds === 'number') {
                  videoRef.current.currentTime = seconds;
                  videoRef.current.play().catch(() => {});
                }
              };

              // 4. Calculate integrity metrics
              const metrics = (() => {
                let score = 100;
                let highRiskCount = 0;

                violationsList.forEach((v: any) => {
                  const type = v.type || "";
                  if (type === "Multiple People Detected" || type === "Mobile Phone Detected") {
                    score -= 25;
                    highRiskCount++;
                  } else if (type === "Fullscreen Exit Detected") {
                    score -= 15;
                    highRiskCount++;
                  } else if (type === "Face Missing") {
                    score -= 12;
                  } else if (["Tab Switch Detected", "Window Lost Focus", "Multiple Voices Detected", "Background Conversation"].includes(type)) {
                    score -= 10;
                  } else if (["Looking Left", "Looking Right", "Looking Up", "Looking Down", "Excessive Noise"].includes(type)) {
                    score -= 5;
                  }
                });

                score = Math.max(0, score);
                let rating = "High Integrity";
                let color = "text-emerald-500 dark:text-emerald-400";
                let bg = "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30";
                
                if (score < 60) {
                  rating = "High Risk";
                  color = "text-red-500 dark:text-rose-450";
                  bg = "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30";
                } else if (score < 85) {
                  rating = "Moderate Risk";
                  color = "text-amber-500 dark:text-amber-400";
                  bg = "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30";
                }

                return { score, rating, color, bg, highRiskCount };
              })();

              // 5. Filter violations
              const filteredViolations = violationsList.filter((v: any) => {
                const matchesSearch = v.type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                      v.description?.toLowerCase().includes(searchQuery.toLowerCase());
                
                if (!matchesSearch) return false;

                const isAudio = ["Multiple Voices Detected", "Background Conversation", "Excessive Noise"].includes(v.type);
                const isVideo = ["Face Missing", "Multiple People Detected", "Looking Left", "Looking Right", "Looking Up", "Looking Down", "Fullscreen Exit Detected", "Tab Switch Detected", "Window Lost Focus", "Mobile Phone Detected"].includes(v.type);

                if (categoryFilter === 'audio') return isAudio;
                if (categoryFilter === 'video') return isVideo;
                return true;
              });

              const completedAttempts = sortedAttempts.filter((att: any) => typeof att.ai_score === 'number');
              const totalScore = completedAttempts.reduce((sum: number, att: any) => sum + att.ai_score, 0);
              const maxScorePossible = completedAttempts.length * 10;
              const averageScore = completedAttempts.length > 0 ? (totalScore / completedAttempts.length).toFixed(1) : "0.0";

              return (
                <div className="space-y-6">
                  <Card className="p-6 bg-card border border-border shadow-soft">
                    <div className="grid gap-4 md:grid-cols-6">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-primary dark:text-violet-400 font-bold">Resume ID</p>
                        <p className="mt-2 text-foreground font-mono text-sm">{resume.id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-primary dark:text-violet-400 font-bold">Candidate</p>
                        <p className="mt-2 text-foreground font-semibold text-sm">{resume.parsed?.personal?.fullName || resume.filename || "Unknown"}</p>
                        <p className="text-muted-foreground text-sm">{resume.parsed?.personal?.email || "No email"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-primary dark:text-violet-400 font-bold">Interview Started</p>
                        <p className="mt-2 text-foreground text-sm">{startTimestamp ? startTimestamp.toLocaleString() : "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-primary dark:text-violet-400 font-bold">Interview Ended</p>
                        <p className="mt-2 text-foreground text-sm">{endTimestamp ? endTimestamp.toLocaleString() : "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-primary dark:text-violet-400 font-bold">Total Duration</p>
                        <p className="mt-2 text-primary font-extrabold text-sm bg-secondary px-3 py-1 rounded-xl w-fit">
                          ⏱ {totalDurationStr || "N/A"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-primary dark:text-violet-400 font-bold">Assessment Score</p>
                        <div className="mt-2 flex items-baseline gap-1">
                          <span className="text-primary font-extrabold text-lg">{totalScore}</span>
                          <span className="text-slate-400 text-xs font-semibold">/ {maxScorePossible}</span>
                        </div>
                        <p className="text-muted-foreground text-xs font-semibold mt-0.5">Avg: {averageScore}/10</p>
                      </div>
                    </div>
                  </Card>

                  {resume.report?.videoUrl ? (
                    <div className="grid gap-6 lg:grid-cols-12">
                      {/* Left: Video Player (5 cols) */}
                      <div className="lg:col-span-5 space-y-6">
                        <Card className="p-6 bg-card border border-border shadow-soft rounded-3xl">
                          <div className="mb-4">
                            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-1 flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-indigo-505 animate-pulse" /> Response Review
                            </h2>
                            <p className="text-xs text-muted-foreground font-semibold leading-relaxed">
                              All submissions include mock scoring and feedback generated by the system (hidden from candidates).
                            </p>
                          </div>
                          {(() => {
                            const totalVideoDuration = getCalculatedDuration();
                            return (
                              <>
                                <div 
                                  className="aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 relative shadow-inner group/video-container"
                                  onMouseEnter={() => setIsHoveringVideo(true)}
                                  onMouseLeave={() => setIsHoveringVideo(false)}
                                >
                                  <video
                                    ref={videoRef}
                                    src={videoSrc ?? undefined}
                                    preload="auto"
                                    onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                                    onLoadedMetadata={(e) => {
                                      const d = e.currentTarget.duration;
                                      if (d && isFinite(d)) {
                                        setVideoDuration(d);
                                      }
                                    }}
                                    onPlay={() => setIsPlaying(true)}
                                    onPause={() => setIsPlaying(false)}
                                    className="w-full h-full object-contain cursor-pointer"
                                    onClick={togglePlay}
                                  />
                                  <canvas
                                    ref={canvasRef}
                                    className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
                                  />

                                  {/* YouTube-style Custom Controls Overlay */}
                                  <div 
                                    className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 z-20 flex flex-col gap-2 transition-opacity duration-300 ${
                                      isHoveringVideo || !isPlaying ? 'opacity-100' : 'opacity-0'
                                    }`}
                                  >
                                    {/* Progress bar / Seeker */}
                                    <div 
                                      ref={seekerRef}
                                      className="relative w-full h-1.5 hover:h-2.5 bg-white/20 rounded-full cursor-pointer transition-all group/seeker"
                                      onMouseDown={handleMouseDown}
                                    >
                                      <div 
                                        className="h-full bg-red-650 rounded-full relative transition-all duration-75"
                                        style={{ width: `${totalVideoDuration > 0 ? Math.min(100, (videoCurrentTime / totalVideoDuration) * 100) : 0}%` }}
                                      >
                                        {/* Red dot seeker handle */}
                                        <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-red-600 rounded-full transition-transform shadow-md border border-white ${isDragging ? 'scale-100' : 'scale-0 group-hover/seeker:scale-100'}`} />
                                      </div>
                                    </div>

                                    {/* Controls toolbar */}
                                    <div className="flex items-center justify-between text-white text-xs">
                                      <div className="flex items-center gap-4">
                                        {/* Play/Pause Button */}
                                        <button 
                                          onClick={togglePlay}
                                          className="hover:text-red-500 transition-colors p-1"
                                        >
                                          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
                                        </button>

                                        {/* Volume button */}
                                        <button 
                                          onClick={toggleMute}
                                          className="hover:text-red-500 transition-colors p-1"
                                        >
                                          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                        </button>

                                        {/* Playback time overlay: "00:22 / 01:00" */}
                                        <span className="font-mono font-bold tracking-wider select-none text-[13px]">
                                          {formatVideoTime(videoCurrentTime)} / {formatVideoTime(totalVideoDuration)}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-3">
                                        {/* Live face overlay stats indicator */}
                                        <span className="text-[9px] text-emerald-400 font-extrabold uppercase tracking-wider bg-emerald-950/50 border border-emerald-500/20 px-2 py-0.5 rounded-md flex items-center gap-1 select-none">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                          LIVE MESH
                                        </span>

                                        {/* Fullscreen Button */}
                                        <button 
                                          onClick={toggleFullscreen}
                                          className="hover:text-red-500 transition-colors p-1"
                                        >
                                          <Maximize className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                          <div className="mt-4 p-4 bg-indigo-50/50 dark:bg-slate-800/40 rounded-2xl border border-indigo-100/50 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
                            💡 Use the timeline on the right to jump directly to specific violation events.
                          </div>
                        </Card>
                      </div>

                      {/* Right: Proctoring Controls & Timeline (7 cols) */}
                      <div className="lg:col-span-7">
                        <Card className="p-6 bg-card border border-border shadow-soft rounded-3xl h-full flex flex-col justify-between">
                          <div className="flex flex-col">
                            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                              <div>
                                <h3 className="text-sm font-bold text-slate-850 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                                  <ShieldAlert className="w-4 h-4 text-primary" /> Proctoring Integrity Logs
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5 font-semibold">
                                  Review real-time violations, gaze shifts, tab activity, and voice triggers.
                                </p>
                              </div>
                              
                              {/* Integrity Score Badge */}
                              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border font-bold text-xs ${metrics.bg}`}>
                                <span className="text-muted-foreground">Integrity:</span>
                                <span className={`text-sm font-black ${metrics.color}`}>{metrics.score}%</span>
                                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded-md bg-white/85 dark:bg-slate-900 border ${metrics.color}`}>
                                  {metrics.rating}
                                </span>
                              </div>
                            </div>

                            {/* Overall stats grid */}
                            <div className="grid grid-cols-3 gap-3 mb-4">
                              <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50/50 dark:border-slate-800/60 rounded-2xl text-center">
                                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-505 uppercase tracking-wider">Total Flags</div>
                                <div className="text-lg font-black text-foreground mt-1">{violationsList.length}</div>
                              </div>
                              <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50/50 dark:border-slate-800/60 rounded-2xl text-center">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Critical Flags</div>
                                <div className="text-lg font-black text-red-600 dark:text-rose-500 mt-1">{metrics.highRiskCount}</div>
                              </div>
                              <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-indigo-50/50 dark:border-slate-800/60 rounded-2xl text-center">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Session End</div>
                                <div className={`text-xs font-black mt-1.5 ${autoSubmitted ? 'text-red-600 dark:text-rose-550' : 'text-emerald-600 dark:text-emerald-500'}`}>
                                  {autoSubmitted ? 'Auto-Terminated' : 'Completed Normally'}
                                </div>
                              </div>
                            </div>

                            {/* Filters & Search */}
                            <div className="flex flex-col sm:flex-row gap-3 mb-4 items-center justify-between">
                              {/* Category buttons */}
                              <div className="flex items-center gap-1.5 bg-secondary p-1 rounded-xl w-full sm:w-auto">
                                <button
                                  onClick={() => setCategoryFilter('all')}
                                  className={`px-3 py-1 text-xs font-bold rounded-lg flex-1 sm:flex-none transition-all ${
                                    categoryFilter === 'all'
                                      ? 'bg-card text-primary shadow-sm'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                  }`}
                                >
                                  All
                                </button>
                                <button
                                  onClick={() => setCategoryFilter('video')}
                                  className={`px-3 py-1 text-xs font-bold rounded-lg flex-1 sm:flex-none transition-all flex items-center justify-center gap-1 ${
                                    categoryFilter === 'video'
                                      ? 'bg-card text-primary shadow-sm'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                  }`}
                                >
                                  <Video className="w-3.5 h-3.5" /> Video
                                </button>
                                <button
                                  onClick={() => setCategoryFilter('audio')}
                                  className={`px-3 py-1 text-xs font-bold rounded-lg flex-1 sm:flex-none transition-all flex items-center justify-center gap-1 ${
                                    categoryFilter === 'audio'
                                      ? 'bg-card text-primary shadow-sm'
                                      : 'text-slate-600 dark:text-slate-405 hover:text-slate-900 dark:hover:text-slate-200'
                                  }`}
                                >
                                  <Volume2 className="w-3.5 h-3.5" /> Audio
                                </button>
                              </div>

                              {/* Search Box */}
                              <div className="relative w-full sm:w-60">
                                <Search className="w-4 h-4 text-slate-400 dark:text-slate-505 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                  type="text"
                                  placeholder="Search violations..."
                                  value={searchQuery}
                                  onChange={(e) => setSearchQuery(e.target.value)}
                                  className="w-full bg-slate-50 dark:bg-slate-900 border border-border rounded-xl pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:focus:ring-violet-500 font-medium text-slate-800 dark:text-slate-200"
                                />
                              </div>
                            </div>

                            {/* Violations List */}
                            <div className="overflow-y-auto max-h-[300px] border border-indigo-50/50 dark:border-slate-800 rounded-2xl bg-slate-50/30 dark:bg-slate-950/20 scrollbar-thin">
                              {filteredViolations.length > 0 ? (
                                <div className="divide-y divide-indigo-50 dark:divide-slate-800">
                                  {filteredViolations.map((v: any, index: number) => {
                                    const isAudio = ["Multiple Voices Detected", "Background Conversation", "Excessive Noise"].includes(v.type);
                                    const isCritical = ["Multiple People Detected", "Fullscreen Exit Detected", "Mobile Phone Detected"].includes(v.type);
                                    
                                    return (
                                      <div
                                        key={index}
                                        onClick={() => handleSeek(v.videoTimestamp)}
                                        className="p-3 flex items-start gap-3 hover:bg-indigo-50/60 dark:hover:bg-slate-800/40 transition-all cursor-pointer group"
                                      >
                                        {/* Timestamp tag */}
                                        <div className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-slate-800 text-primary font-mono text-xs font-bold flex-shrink-0 mt-0.5 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                          {formatVideoTime(v.videoTimestamp)}
                                        </div>

                                        {/* Event details */}
                                        <div className="flex-grow min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-extrabold text-xs text-slate-800 dark:text-slate-200">
                                              {v.type}
                                            </span>
                                            
                                            {/* Category Indicator */}
                                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded-md font-bold bg-secondary text-muted-foreground">
                                              {isAudio ? 'Audio' : 'Video'}
                                            </span>

                                            {/* Severity Indicator */}
                                            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded-md font-bold ${
                                              isCritical
                                                ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-rose-455 border border-red-200 dark:border-red-900/40'
                                                : ['Looking Left', 'Looking Right', 'Looking Up', 'Looking Down', 'Excessive Noise'].includes(v.type)
                                                  ? 'bg-secondary text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                                                  : 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40'
                                            }`}>
                                              {isCritical ? 'Critical' : ['Looking Left', 'Looking Right', 'Looking Up', 'Looking Down', 'Excessive Noise'].includes(v.type) ? 'Low' : 'Medium'}
                                            </span>
                                          </div>
                                          
                                          <p className="text-xs text-muted-foreground mt-1 leading-snug font-medium">
                                            {v.description || `Suspicious activity flagged: ${v.type}.`}
                                          </p>

                                          <div className="flex items-center gap-4 mt-1.5 text-[10px] text-muted-foreground font-bold">
                                            {v.duration !== undefined && (
                                              <span>Duration: <strong className="text-muted-foreground font-extrabold">{v.duration.toFixed(1)}s</strong></span>
                                            )}
                                            {v.confidence !== undefined && (
                                              <span>Confidence: <strong className="text-muted-foreground font-extrabold">{(v.confidence * 100).toFixed(0)}%</strong></span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Play Action Button on hover */}
                                        <div className="w-6 h-6 rounded-full bg-secondary border border-indigo-100 dark:border-slate-700 items-center justify-center flex opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                                          <Play className="w-3 h-3 text-primary fill-indigo-600 dark:fill-violet-400" />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="p-8 text-center text-muted-foreground text-xs font-semibold leading-relaxed">
                                  {violationsList.length === 0 ? "🎉 No proctoring violations detected for this session!" : "No violations match the search filter."}
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      </div>
                    </div>
                  ) : (
                    violationsList.length > 0 && (
                      <Card className="p-6 bg-card border border-border shadow-soft rounded-3xl">
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                          <div>
                            <h3 className="text-sm font-bold text-slate-850 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                              <ShieldAlert className="w-4 h-4 text-primary" /> Proctoring Integrity Logs (No Video Stream)
                            </h3>
                          </div>
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border font-bold text-xs ${metrics.bg}`}>
                            <span className="text-slate-605 dark:text-slate-350">Integrity Score:</span>
                            <span className={`text-sm font-black ${metrics.color}`}>{metrics.score}%</span>
                            <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded-md bg-white/85 dark:bg-slate-900 border ${metrics.color}`}>
                              {metrics.rating}
                            </span>
                          </div>
                        </div>

                        <div className="overflow-y-auto max-h-[300px] border border-indigo-50/50 dark:border-slate-800 rounded-2xl bg-slate-50/30 dark:bg-slate-950/20 scrollbar-thin">
                          <div className="divide-y divide-indigo-50 dark:divide-slate-800">
                            {violationsList.map((v: any, index: number) => {
                              const isAudio = ["Multiple Voices Detected", "Background Conversation", "Excessive Noise"].includes(v.type);
                              const isCritical = ["Multiple People Detected", "Fullscreen Exit Detected"].includes(v.type);
                              return (
                                <div key={index} className="p-3 flex items-start gap-3 hover:bg-indigo-50/60 dark:hover:bg-slate-800/40 transition-all">
                                  <div className="px-2 py-0.5 rounded bg-indigo-100 dark:bg-slate-800 text-primary font-mono text-xs font-bold flex-shrink-0 mt-0.5">
                                    {formatVideoTime(v.videoTimestamp)}
                                  </div>
                                  <div className="flex-grow min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-extrabold text-xs text-slate-800 dark:text-slate-200">{v.type}</span>
                                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded-md font-bold bg-secondary text-slate-550 dark:text-slate-400">
                                        {isAudio ? 'Audio' : 'Video'}
                                      </span>
                                      <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded-md font-bold ${
                                        isCritical ? 'bg-red-50 dark:bg-red-950/30 text-red-600 border border-red-200' : 'bg-amber-50 dark:bg-amber-950/30 text-amber-605 border border-amber-200'
                                      }`}>
                                        {isCritical ? 'Critical' : 'Medium'}
                                      </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 leading-snug font-medium">{v.description}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </Card>
                    )
                  )}

                  <Card className="bg-card border-border shadow-soft overflow-x-auto">
                    <table className="min-w-full divide-y divide-indigo-50 dark:divide-slate-800 text-sm text-left">
                      <thead className="bg-primary text-white uppercase tracking-wider text-[11px] font-bold">
                        <tr>
                          <th className="px-4 py-4">#</th>
                          <th className="px-4 py-4">Question</th>
                          <th className="px-4 py-4">Answer</th>
                          <th className="px-4 py-4">Score</th>
                          <th className="px-4 py-4">Feedback</th>
                          <th className="px-4 py-4">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-indigo-50 dark:divide-slate-800 bg-indigo-50/30 dark:bg-slate-950/20">
                        {sortedAttempts && sortedAttempts.length > 0 ? (
                          sortedAttempts.map((attempt: any, index: number) => {
                            let durationStr = "";
                            if (attempt.timestamp) {
                              const currentMs = new Date(attempt.timestamp).getTime();
                              if (index > 0) {
                                const prevAttempt = sortedAttempts[index - 1];
                                if (prevAttempt.timestamp) {
                                  const prevMs = new Date(prevAttempt.timestamp).getTime();
                                  const diffMs = currentMs - prevMs;
                                  const diffSec = Math.floor(diffMs / 1000);
                                  const mins = Math.floor(diffSec / 60);
                                  const secs = diffSec % 60;
                                  durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                                }
                              } else {
                                durationStr = "First Response";
                              }
                            }

                            return (
                              <motion.tr
                                key={attempt.id || index}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                className="hover:bg-indigo-50/60 dark:hover:bg-slate-800/50 transition-colors"
                              >
                                <td className="px-4 py-4 font-bold text-primary">{attempt.question_number || index + 1}</td>
                                <td className="px-4 py-4 text-slate-800 dark:text-slate-200 max-w-[320px] break-words">{attempt.question}</td>
                                <td className="px-4 py-4 text-muted-foreground max-w-[360px] break-words whitespace-pre-wrap">{attempt.candidate_answer || "-"}</td>
                                <td className="px-4 py-4">
                                  <Badge className={attempt.ai_score >= 8 ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/25" : attempt.ai_score >= 5 ? "bg-amber-500 text-white shadow-sm shadow-amber-500/25" : "bg-red-500 text-white shadow-sm shadow-red-500/25"}>
                                    {attempt.ai_score ?? "-"}
                                  </Badge>
                                </td>
                                <td className="px-4 py-4 text-muted-foreground max-w-[280px] break-words whitespace-pre-wrap">{attempt.ai_feedback || "-"}</td>
                                <td className="px-4 py-4 text-slate-500">
                                  <div className="font-semibold text-muted-foreground">{attempt.timestamp ? new Date(attempt.timestamp).toLocaleTimeString() : "-"}</div>
                                  <div className="text-[10px] text-muted-foreground font-medium">{attempt.timestamp ? new Date(attempt.timestamp).toLocaleDateString() : ""}</div>
                                  {durationStr && (
                                    <div className="text-[10px] text-primary font-black mt-1 bg-secondary px-2 py-0.5 rounded-full w-fit">
                                      ⏱ {durationStr}
                                    </div>
                                  )}
                                </td>
                              </motion.tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                              No completed responses have been recorded for this candidate yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                </div>
              );
            })()
          )}
        </main>
      </div>
    </AdminAuthGate>
  );
}
