"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, CheckCircle, ArrowRight, ShieldAlert, Loader2, Sparkles, Bot, Volume2, RotateCcw, ChevronDown, ChevronUp, Code2, AlertCircle, Camera, Upload, ShieldCheck } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

const DEFAULT_TEMPLATES: Record<string, string> = {
  javascript: `// JavaScript Code Template\n\nfunction solution() {\n  // Write your code here\n  \n  return;\n}`,
  typescript: `// TypeScript Code Template\n\nfunction solution(): void {\n  // Write your code here\n  \n  return;\n}`,
  python: `# Python Code Template\n\ndef solution():\n    # Write your code here\n    pass`,
  cpp: `// C++ Code Template\n#include <iostream>\nusing namespace std;\n\nvoid solution() {\n    // Write your code here\n}`,
  java: `// Java Code Template\npublic class Solution {\n    public static void solution() {\n        // Write your code here\n    }\n}`
};

const TOTAL_SECONDS = 15 * 60;
const COMPLETION_TEXT = "The interview has concluded. Your responses have been securely shared with the recruitment team for review. We will contact you regarding the next steps.";

// Safe check for Speech Recognition support
const SpeechRecognition = typeof window !== 'undefined' && (
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
);

const createMediaRecorder = (stream: MediaStream): MediaRecorder | null => {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    console.warn("MediaRecorder is not supported in this environment.");
    return null;
  }
  
  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
  ];

  for (const type of mimeTypes) {
    try {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
        console.log(`Using supported MIME type for MediaRecorder: ${type}`);
        return new MediaRecorder(stream, { mimeType: type });
      }
    } catch (e) {
      console.warn(`MIME type check failed for ${type}:`, e);
    }
  }

  try {
    console.log("No specific custom MIME type supported, falling back to default MediaRecorder.");
    return new MediaRecorder(stream);
  } catch (e) {
    console.error("Failed to instantiate default MediaRecorder:", e);
    return null;
  }
};

export default function CandidatePortal() {
  const params = useParams();
  const resumeId = params?.id as string;

  const [questions, setQuestions] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedLanguage, setSelectedLanguage] = useState('javascript');
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<number, string>>({});
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [interviewEnded, setInterviewEnded] = useState(false);
  const [answer, setAnswer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [currentStep, setCurrentStep] = useState<'setup' | 'intro' | 'questions' | 'candidate_question'>('setup');

  // Identity Verification States
  const [showIdVerification, setShowIdVerification] = useState(false);
  const [idImageBase64, setIdImageBase64] = useState<string | null>(null);
  const [selfieImageBase64, setSelfieImageBase64] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<{ matched: boolean; confidence: number; reason: string } | null>(null);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [showSubmitWithoutRunConfirm, setShowSubmitWithoutRunConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{
    step: 'intro' | 'questions' | 'candidate_question';
    index: number;
  } | null>(null);
  
  // Proctoring States
  const [warningCount, setWarningCount] = useState(0);
  const [violations, setViolations] = useState<Array<{ type: string; timestamp: string; warningCount: number }>>([]);
  const [isFullscreenActive, setIsFullscreenActive] = useState(true);
  const [proctorState, setProctorState] = useState<'one' | 'none' | 'multiple' | 'phone'>('one');
  const [proctorAlerts, setProctorAlerts] = useState<Array<{ id: string; type: string; message: string }>>([]);
  const [showFullscreenRequired, setShowFullscreenRequired] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<{
    compiles: boolean;
    error: string | null;
    testCases: { name: string; input: string; expected: string; actual: string; passed: boolean }[];
    score: number | null;
  } | null>(null);
  const [isRunningCode, setIsRunningCode] = useState(false);
  const [isTechExpanded, setIsTechExpanded] = useState(true);
  const [isCodingExpanded, setIsCodingExpanded] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [clmReady, setClmReady] = useState(false);

  // Speech & Speaker Highlighting states
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [userVolume, setUserVolume] = useState(0);
  const [isMicListening, setIsMicListening] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [showManualCheckNotice, setShowManualCheckNotice] = useState(false);
  const verificationTimeoutRef = useRef<any>(null);

  const [hasSavedSession, setHasSavedSession] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && resumeId) {
      const saved = localStorage.getItem(`candidate_interview_${resumeId}`);
      if (saved) {
        setHasSavedSession(true);
      }
    }
  }, [resumeId]);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (!resumeId || interviewEnded || hasSavedSession) return;
    
    // Only save if the step is actually initialized beyond setup
    if (currentStep === 'setup' && !hasAgreed) return;

    const stateToSave = {
      currentStep,
      currentIndex,
      secondsLeft,
      warningCount,
      violations,
      idImageBase64,
      selfieImageBase64,
      verificationResult,
      hasAgreed,
      selectedLanguage,
      answer,
    };
    
    try {
      localStorage.setItem(`candidate_interview_${resumeId}`, JSON.stringify(stateToSave));
    } catch (e) {
      console.warn("Failed to save interview state to localStorage:", e);
    }
  }, [
    resumeId,
    currentStep,
    currentIndex,
    secondsLeft,
    warningCount,
    violations,
    idImageBase64,
    selfieImageBase64,
    verificationResult,
    hasAgreed,
    selectedLanguage,
    answer,
    interviewEnded,
    hasSavedSession
  ]);

  const handleResumeSession = async () => {
    try {
      setGeneralError(null);
      // Re-request permissions
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          facingMode: 'user'
        }, 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true 
        } 
      });
      
      console.log("✅ Camera stream re-acquired successfully");
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(e => console.warn("Video play error:", e));
      }

      const mediaRecorder = createMediaRecorder(stream);
      if (mediaRecorder) {
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          setIsUploadingVideo(true);
          try {
            const recordingDuration = recordingStartTimeRef.current 
              ? Math.floor((Date.now() - recordingStartTimeRef.current) / 1000) 
              : 0;
            console.log(`🎬 MediaRecorder stopped. Chunk count: ${chunksRef.current.length} Duration: ${recordingDuration}s`);
            
            const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'video/webm' });
            console.log(`📦 Created recording Blob size: ${blob.size} bytes`);
            
            const file = new File([blob], `${resumeId}_interview.webm`, { type: 'video/webm' });
            const formData = new FormData();
            formData.append('video', file);
            formData.append('duration', String(recordingDuration));
            
            const uploadRes = await fetch(`/api/interview/${resumeId}/upload_video`, {
              method: 'POST',
              body: formData,
            });
            if (!uploadRes.ok) {
              const errorData = await uploadRes.json();
              console.error("❌ Failed to upload recording file. Status:", uploadRes.status, "Error:", errorData);
            } else {
              console.log("✅ Video uploaded successfully");
            }
          } catch (uploadErr) {
            console.error("❌ Error uploading video blob:", uploadErr);
          } finally {
            setIsUploadingVideo(false);
          }
        };

        try {
          mediaRecorder.start(1000);
          setIsRecording(true);
          recordingStartTimeRef.current = Date.now();
        } catch (err) {
          console.error("Error starting media recorder on resume:", err);
        }
      }

      // Restore states
      const savedStr = localStorage.getItem(`candidate_interview_${resumeId}`);
      if (savedStr) {
        const saved = JSON.parse(savedStr);
        setCurrentStep(saved.currentStep);
        setCurrentIndex(saved.currentIndex);
        setSecondsLeft(saved.secondsLeft);
        setWarningCount(saved.warningCount);
        setViolations(saved.violations || []);
        setIdImageBase64(saved.idImageBase64);
        setSelfieImageBase64(saved.selfieImageBase64);
        setVerificationResult(saved.verificationResult);
        setHasAgreed(saved.hasAgreed);
        setSelectedLanguage(saved.selectedLanguage || 'javascript');
        setAnswer(saved.answer || '');

        // If the step is questions, intro, or candidate_question, activate listeners and timer
        if (saved.currentStep !== 'setup') {
          // Restart timer
          timerIdRef.current = window.setInterval(() => {
            setSecondsLeft(prev => {
              if (prev <= 1) {
                stopTimer();
                finalizeInterview();
                return 0;
              }
              return prev - 1;
            });
          }, 1000);

          setupAudioAnalyser(stream);
          setupSpeechRecognition();
        }
      }

      // Activate Fullscreen
      const docEl = document.documentElement;
      try {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if ((docEl as any).webkitRequestFullscreen) {
          await (docEl as any).webkitRequestFullscreen();
        }
      } catch (err) {
        console.error("Fullscreen request failed during resume:", err);
      }

      setHasSavedSession(false);
    } catch (err: any) {
      console.error("Failed to resume session:", err);
      setGeneralError(err.message || "Could not access camera/microphone. Please ensure permissions are granted.");
    }
  };

  const isCodingQuestion = currentStep === 'questions' && questions[currentIndex]?.startsWith("Coding Challenge:");
  const isCodingQuestionRef = useRef(isCodingQuestion);
  useEffect(() => {
    isCodingQuestionRef.current = isCodingQuestion;
  }, [isCodingQuestion]);

  const timerIdRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const verificationVideoRef = useRef<HTMLVideoElement>(null);
  const videoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    if (node) {
      (videoRef as any).current = node;
      if (streamRef.current && node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
    }
  }, []);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  
  // Speech & Audio Analysis references
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const isMicListeningRef = useRef(isMicListening);
  const recordingStartTimeRef = useRef<number | null>(null);
  const lastTriggeredViolationsRef = useRef<Record<string, number>>({});
  const warningCountRef = useRef(0);
  useEffect(() => {
    warningCountRef.current = warningCount;
  }, [warningCount]);
  useEffect(() => {
    isMicListeningRef.current = isMicListening;
  }, [isMicListening]);
  // Sync stream with video element whenever streamRef changes
  useEffect(() => {
    if (streamRef.current && videoRef.current) {
      console.log("🔄 Syncing stream to video element...");
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().then(() => {
        console.log("✅ Video element playing after stream sync");
      }).catch((err) => {
        console.warn("⚠️ Video play error after stream sync:", err);
      });
    }
  }, []);  // Empty deps - runs once on mount to ensure sync

  const exitFullscreen = () => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => console.debug("Exit fullscreen error:", err));
      }
    } catch (e) {}
  };

  const stopListening = () => {
    setIsMicListening(false);
    isMicListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.debug("Stop speech recognition error:", err);
      }
    }
  };

  const stopTimer = () => {
    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
  };

  const flushPendingViolationRef = useRef<(() => void) | null>(null);

  const finalizeInterview = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`candidate_interview_${resumeId}`);
    }
    if (flushPendingViolationRef.current) {
      try {
        flushPendingViolationRef.current();
      } catch (err) {
        console.error("Failed to flush pending violation on finalize:", err);
      }
    }
    setInterviewEnded(true);
    stopTimer();
    stopListening();
    if (window.speechSynthesis) speechSynthesis.cancel();
    
    // Call conclude API to mark session as used in the backend registry
    fetch(`/api/interview/${resumeId}/conclude`, { method: 'POST' }).catch(e => {
      console.error("Failed to mark interview as concluded:", e);
    });
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(e => console.error(e));
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    exitFullscreen();
  };

  const triggerProctorEvent = useCallback(async (
    violationType: string,
    duration: number,
    confidence: number,
    description: string,
    customWarningCount?: number
  ) => {
    if (interviewEnded || currentStep === 'setup') return;

    // Apply 3-second cooldown per violation type to prevent spam/duplicate logs
    const nowMs = Date.now();
    const lastTimeMs = lastTriggeredViolationsRef.current[violationType] || 0;
    if (nowMs - lastTimeMs < 3000) {
      return;
    }
    lastTriggeredViolationsRef.current[violationType] = nowMs;

    const elapsedSeconds = recordingStartTimeRef.current
      ? Math.max(0, (Date.now() - recordingStartTimeRef.current) / 1000)
      : 0;

    // Let's determine if this violation should count as a warning strikes:
    const isWarningStrike = [
      "Fullscreen Exit Detected",
      "Tab Switch Detected",
      "Window Lost Focus",
      "Face Missing",
      "Multiple People Detected",
      "Multiple Voices Detected",
      "Background Conversation",
      "Mobile Phone Detected",
      "Right Click Attempted",
      "DevTools Shortcut Blocked",
      "Copy/Paste Attempted"
    ].includes(violationType);

    setWarningCount(prevCount => {
      const newCount = typeof customWarningCount === 'number'
        ? customWarningCount
        : (isWarningStrike ? prevCount + 1 : prevCount);
      const timestamp = new Date().toISOString();

      // Post violation event to backend
      fetch(`/api/interview/${resumeId}/proctor_violation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          violationType,
          warningCount: newCount,
          timestamp,
          duration: parseFloat(duration.toFixed(1)),
          confidence: parseFloat(confidence.toFixed(2)),
          description,
          videoTimestamp: parseFloat(elapsedSeconds.toFixed(1))
        })
      }).catch(err => console.error("Failed to log proctor violation:", err));

      // Append to local state array
      setViolations(prev => [
        ...prev,
        { type: violationType, timestamp, warningCount: newCount }
      ]);

      if (newCount >= 3) {
        setTimeout(() => {
          finalizeInterview();
          setShowEndConfirm(false);
          setShowReviewModal(false);
          setShowSubmitWithoutRunConfirm(false);
        }, 1000);
      }

      return newCount;
    });
  }, [interviewEnded, currentStep, resumeId]);

  // Backward compatible wrapper for legacy calls
  const triggerViolation = useCallback(async (violationType: string) => {
    let desc = `System flagged ${violationType}.`;
    let confidence = 0.95;
    let duration = 1.0;

    if (violationType === "Fullscreen Exit Detected") {
      desc = "Candidate exited fullscreen mode.";
      confidence = 1.0;
    } else if (violationType === "Tab Switch Detected") {
      desc = "Candidate switched browser tabs.";
      confidence = 1.0;
    } else if (violationType === "Window Lost Focus") {
      desc = "Candidate unfocused the browser window.";
      confidence = 1.0;
    } else if (violationType === "Right Click Attempted") {
      desc = "Candidate attempted to right-click (open context menu).";
      confidence = 1.0;
    } else if (violationType === "DevTools Shortcut Blocked") {
      desc = "Candidate attempted to open developer tools via keyboard shortcut.";
      confidence = 1.0;
    } else if (violationType === "Copy/Paste Attempted") {
      desc = "Candidate attempted to copy, cut, or paste text.";
      confidence = 1.0;
    }

    triggerProctorEvent(violationType, duration, confidence, desc);
  }, [triggerProctorEvent]);

  useEffect(() => {
    if (!resumeId) return;

    fetch(`/api/interview/${resumeId}/questions`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setQuestions(data);
        } else {
          console.error("Failed to load questions, invalid data", data);
          setGeneralError("Failed to load questions for this interview. Please refresh the page.");
        }
        setIsInitializing(false);
      })
      .catch(err => {
        console.error("Failed to load questions", err);
        setIsInitializing(false);
        setGeneralError("Failed to load questions. Please check your connection and try again.");
      });

    // Fetch previously submitted answers
    fetch(`/api/interview/${resumeId}/answers`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const map: Record<number, string> = {};
          data.forEach(row => {
            map[row.question_index] = row.answer;
          });
          setSubmittedAnswers(map);
        }
      })
      .catch(err => console.error("Failed to fetch submitted answers:", err));

    return () => {
      stopTimer();
      if (window.speechSynthesis) speechSynthesis.cancel();
      
      // Stop speech recognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
        recognitionRef.current = null;
      }

      // Stop Audio Analyser
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(e => console.error(e));
      }

      // Stop media tracks
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [resumeId]);

  useEffect(() => {
    setTerminalOutput(null);
    const isCoding = currentStep === 'questions' && questions[currentIndex]?.startsWith("Coding Challenge:");
    if (isCoding) {
      stopListening();
      const cached = submittedAnswers[currentIndex];
      if (cached !== undefined) {
        setAnswer(cached);
      } else {
        const normalize = (str: string) => str.replace(/\r\n/g, '\n').trim();
        const normalizedAnswer = normalize(answer);
        const isCurrentTemplate = Object.values(DEFAULT_TEMPLATES).some(
          tpl => normalize(tpl) === normalizedAnswer
        );
        if (!answer || answer.trim() === "" || isCurrentTemplate) {
          setAnswer(DEFAULT_TEMPLATES[selectedLanguage] || "");
        }
      }
    }
  }, [currentIndex, currentStep, selectedLanguage, submittedAnswers, questions]);

  // Link fullscreen active state to proctorState
  useEffect(() => {
    if (!isFullscreenActive) {
      setProctorState('none');
    } else {
      setProctorState('one');
    }
  }, [isFullscreenActive]);

  // Fullscreen and Tab/Focus proctoring listeners
  useEffect(() => {
    if (currentStep === 'setup' || (currentStep === 'intro' && !hasAgreed) || interviewEnded) return;

    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      setIsFullscreenActive(isCurrentlyFullscreen);
      
      if (!isCurrentlyFullscreen && !interviewEnded) {
        setShowFullscreenRequired(true);
        triggerViolation("Fullscreen Exit Detected");
      } else {
        setShowFullscreenRequired(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && !interviewEnded) {
        triggerViolation("Tab Switch Detected");
      }
    };

    const handleWindowBlur = () => {
      if (!interviewEnded) {
        triggerViolation("Window Lost Focus");
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerViolation("Right Click Attempted");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const isAlt = e.altKey;

      const isF12 = e.key === 'F12' || e.keyCode === 123;
      const isDevToolsShortcut = 
        (isCmdOrCtrl && isShift && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c' || e.key === 'K' || e.key === 'k' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67 || e.keyCode === 75)) ||
        (isCmdOrCtrl && isAlt && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) ||
        (isCmdOrCtrl && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) ||
        (isCmdOrCtrl && (e.key === 'S' || e.key === 's' || e.keyCode === 83));

      if (isF12 || isDevToolsShortcut) {
        e.preventDefault();
        e.stopPropagation();
        triggerViolation("DevTools Shortcut Blocked");
      }
    };

    const handleCopyCutPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerViolation("Copy/Paste Attempted");
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('copy', handleCopyCutPaste);
    document.addEventListener('cut', handleCopyCutPaste);
    document.addEventListener('paste', handleCopyCutPaste);
    document.addEventListener('selectstart', handleSelectStart);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('copy', handleCopyCutPaste);
      document.removeEventListener('cut', handleCopyCutPaste);
      document.removeEventListener('paste', handleCopyCutPaste);
      document.removeEventListener('selectstart', handleSelectStart);
    };
  }, [currentStep, interviewEnded, hasAgreed, triggerViolation]);

  // Dynamic Loading of clmtrackr scripts from CDN
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
        console.error("Failed to load clmtrackr scripts from CDN:", err);
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

  // Proctor State checks using clmtrackr face tracking & head-pose gaze estimation
  useEffect(() => {
    if (currentStep === 'setup' || interviewEnded) return;

    let trackerInstance: any = null;
    let intervalId: any = null;
    let lastState: 'one' | 'none' | 'left' | 'right' | 'up' | 'down' | 'multiple' | 'phone' = 'one';
    let stateStartTime = Date.now();
    let hasIncrementedWarning = false;
    let isTracking = false;

    // History for smoothing/debouncing state transitions
    const stateHistory: string[] = [];

    const startTracking = () => {
      if (!clmReady || !(window as any).clm || !(window as any).pModel) return;
      try {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        trackerInstance = new (window as any).clm.tracker();
        trackerInstance.init((window as any).pModel);
        trackerInstance.start(videoRef.current);
        isTracking = true;
      } catch (err) {
        console.debug("Failed to start clmtrackr:", err);
      }
    };

    if (clmReady) {
      startTracking();
    }

    const flushPending = () => {
      if (hasIncrementedWarning && lastState !== 'one') {
        const duration = (Date.now() - stateStartTime) / 1000;
        let type = "Face Missing";
        let desc = "Face completely leaves the frame, is obscured, or camera blocked.";
        let confidence = 0.90;

        if (lastState === 'left') { type = "Looking Left"; desc = "Candidate looked away to the left."; confidence = 0.85; }
        else if (lastState === 'right') { type = "Looking Right"; desc = "Candidate looked away to the right."; confidence = 0.85; }
        else if (lastState === 'up') { type = "Looking Up"; desc = "Candidate looked up excessively."; confidence = 0.80; }
        else if (lastState === 'down') { type = "Looking Down"; desc = "Candidate looked down (possible phone usage)."; confidence = 0.85; }
        else if (lastState === 'multiple') { type = "Multiple People Detected"; desc = "Multiple people detected in webcam feed."; confidence = 0.95; }
        else if (lastState === 'phone') { type = "Mobile Phone Detected"; desc = "Mobile phone detected in webcam feed."; confidence = 0.98; }

        triggerProctorEvent(type, duration, confidence, desc, warningCountRef.current);
        hasIncrementedWarning = false;
      }
    };

    flushPendingViolationRef.current = flushPending;

    intervalId = setInterval(() => {
      // Check developer mode overrides
      if (proctorState === 'none') {
        const now = Date.now();
        if (lastState !== 'none') {
          flushPending();
          lastState = 'none';
          stateStartTime = now;
          hasIncrementedWarning = false;
        } else if (now - stateStartTime >= 2000 && !hasIncrementedWarning) {
          setWarningCount(prev => {
            const next = prev + 1;
            warningCountRef.current = next;
            return next;
          });
          hasIncrementedWarning = true;
        }
        return;
      }

      if (proctorState === 'multiple') {
        const now = Date.now();
        if (lastState !== 'multiple') {
          flushPending();
          lastState = 'multiple';
          stateStartTime = now;
          hasIncrementedWarning = false;
        } else if (now - stateStartTime >= 2000 && !hasIncrementedWarning) {
          setWarningCount(prev => {
            const next = prev + 1;
            warningCountRef.current = next;
            return next;
          });
          hasIncrementedWarning = true;
        }
        return;
      }

      if (proctorState === 'phone') {
        const now = Date.now();
        if (lastState !== 'phone') {
          flushPending();
          lastState = 'phone';
          stateStartTime = now;
          hasIncrementedWarning = false;
        } else if (now - stateStartTime >= 2000 && !hasIncrementedWarning) {
          setWarningCount(prev => {
            const next = prev + 1;
            warningCountRef.current = next;
            return next;
          });
          hasIncrementedWarning = true;
        }
        return;
      }

      if (!clmReady || !isTracking || !trackerInstance || !(window as any).clm || !(window as any).pModel) {
        if (lastState !== 'one') {
          flushPending();
          lastState = 'one';
          stateStartTime = Date.now();
          hasIncrementedWarning = false;
        }
        if (clmReady) {
          startTracking();
        }
        return;
      }

      const positions = trackerInstance.getCurrentPosition();
      const score = trackerInstance.getScore();

      let detectedState: typeof lastState = 'one';
      let confidence = score || 0;

      if (!positions || positions.length < 70 || score < 0.35) {
        detectedState = 'none';
        confidence = score || 0.15;
      } else {
        const noseX = positions[62][0];
        const noseY = positions[62][1];
        const leftFaceX = positions[1][0];
        const rightFaceX = positions[13][0];
        const noseBridgeY = positions[33][1];
        const chinY = positions[7][1];

        const leftDist = noseX - leftFaceX;
        const rightDist = rightFaceX - noseX;
        const horizontalRatio = leftDist / (rightDist || 1);

        const noseLen = noseY - noseBridgeY;
        const chinLen = chinY - noseY;
        const verticalRatio = noseLen / (chinLen || 1);

        if (horizontalRatio < 0.78) {
          detectedState = 'right';
        } else if (horizontalRatio > 1.28) {
          detectedState = 'left';
        } else if (verticalRatio < 0.48) {
          detectedState = 'up';
        } else if (verticalRatio > 0.82) {
          detectedState = 'down';
        } else {
          detectedState = 'one';
        }
      }

      // Smooth the raw detectedState with a majority vote filter
      stateHistory.push(detectedState);
      if (stateHistory.length > 5) {
        stateHistory.shift();
      }

      const counts: Record<string, number> = {};
      let maxCount = 0;
      let smoothedState = detectedState;
      for (const s of stateHistory) {
        counts[s] = (counts[s] || 0) + 1;
        if (counts[s] > maxCount) {
          maxCount = counts[s];
          smoothedState = s as any;
        }
      }

      const now = Date.now();
      if (smoothedState !== lastState) {
        flushPending();
        lastState = smoothedState;
        stateStartTime = now;
        hasIncrementedWarning = false;
      } else {
        const duration = (now - stateStartTime) / 1000;
        const isCodingPhase = questions[currentIndex]?.startsWith("Coding Challenge:");
        const lookAwayDurationThreshold = isCodingPhase ? 10.0 : 4.0;
        const faceMissingDurationThreshold = isCodingPhase ? 15.0 : 6.0;

        if (!hasIncrementedWarning) {
          if (lastState === 'none' && duration >= faceMissingDurationThreshold) {
            setWarningCount(prev => {
              const next = prev + 1;
              warningCountRef.current = next;
              return next;
            });
            hasIncrementedWarning = true;
          } else if (['left', 'right', 'up', 'down'].includes(lastState) && duration >= lookAwayDurationThreshold) {
            setWarningCount(prev => {
              const next = prev + 1;
              warningCountRef.current = next;
              return next;
            });
            hasIncrementedWarning = true;
          }
        }
      }
    }, 200);

    return () => {
      clearInterval(intervalId);
      flushPendingViolationRef.current = null;
      if (trackerInstance) {
        try {
          trackerInstance.stop();
        } catch(e){}
      }
    }
  }, [currentStep, interviewEnded, clmReady, proctorState, triggerProctorEvent]);

  // Sync stream with verification video element
  useEffect(() => {
    if (showIdVerification && streamRef.current && verificationVideoRef.current) {
      console.log("🔄 Syncing stream to verification video element...");
      verificationVideoRef.current.srcObject = streamRef.current;
      verificationVideoRef.current.play().then(() => {
        console.log("✅ Verification video playing");
      }).catch((err) => {
        console.warn("⚠️ Verification video play error:", err);
      });
    }
  }, [showIdVerification, idImageBase64, selfieImageBase64]);

  const captureImageFromWebcam = (target: 'id' | 'selfie') => {
    if (!verificationVideoRef.current) {
      console.warn("No verification video element found to capture image.");
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = verificationVideoRef.current.videoWidth || 640;
      canvas.height = verificationVideoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(verificationVideoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        if (target === 'id') {
          setIdImageBase64(dataUrl);
        } else {
          setSelfieImageBase64(dataUrl);
        }
        setVerificationError(null);
      }
    } catch (err) {
      console.error("Failed to capture webcam snapshot:", err);
      setVerificationError("Snapshot failed. Please try again.");
    }
  };

  const handleIdFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setVerificationError("File is too large (max 5MB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setIdImageBase64(event.target.result as string);
        setVerificationError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVerifyIdentity = async () => {
    if (!idImageBase64 || !selfieImageBase64) {
      setVerificationError("Both Government ID and Selfie snapshot are required.");
      return;
    }

    setIsVerifying(true);
    setVerificationError(null);
    setVerificationResult(null);
    setShowManualCheckNotice(false);

    if (verificationTimeoutRef.current) {
      window.clearTimeout(verificationTimeoutRef.current);
    }

    // Set 7-minute timeout (7 * 60 * 1000 = 420000ms)
    verificationTimeoutRef.current = window.setTimeout(() => {
      setShowManualCheckNotice(true);
      setVerificationResult({
        matched: false,
        confidence: 0,
        reason: "Timeout: Manual check will be conducted.",
        isSystemError: true
      } as any);
      setIsVerifying(false);
    }, 7 * 60 * 1000);

    try {
      const res = await fetch(`/api/interview/${resumeId}/verify_id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idImage: idImageBase64,
          selfieImage: selfieImageBase64
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Biometric verification failed.");
      }

      // If the timeout has already triggered and handled it, do nothing
      if (verificationTimeoutRef.current === null) return;

      setVerificationResult(data);
      if (!data.matched) {
        setVerificationError(`Verification Failed: ${data.reason}`);
      }
    } catch (err: any) {
      console.error(err);
      // If the timeout has already triggered and handled it, do nothing
      if (verificationTimeoutRef.current === null) return;
      setVerificationError(err.message || "An unexpected error occurred during verification.");
    } finally {
      setIsVerifying(false);
      if (verificationTimeoutRef.current) {
        window.clearTimeout(verificationTimeoutRef.current);
        verificationTimeoutRef.current = null;
      }
    }
  };

  const handleAgreeAndStart = async () => {
    try {
      // Request camera and microphone permissions
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          facingMode: 'user'
        }, 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true 
        } 
      });
      
      console.log("✅ Real camera stream acquired successfully");
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Ensure video plays immediately and check if it's active
        await videoRef.current.play().catch(e => console.warn("Video play error:", e));
        console.log("✅ Video element playing with real stream");
      }

      const mediaRecorder = createMediaRecorder(stream);
      if (mediaRecorder) {
        mediaRecorderRef.current = mediaRecorder;

        chunksRef.current = [];
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          setIsUploadingVideo(true);
          try {
            const recordingDuration = recordingStartTimeRef.current 
              ? (Date.now() - recordingStartTimeRef.current) / 1000 
              : 0;

            const videoBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'video/webm' });
            const formData = new FormData();
            formData.append('video', videoBlob, `${resumeId}.webm`);
            if (recordingDuration > 0) {
              formData.append('duration', recordingDuration.toFixed(1));
            }
            const uploadRes = await fetch(`/api/interview/${resumeId}/upload_video`, {
              method: 'POST',
              body: formData
            });
            if (!uploadRes.ok) {
              const errorData = await uploadRes.json();
              console.error("❌ Failed to upload recording file. Status:", uploadRes.status, "Error:", errorData);
            } else {
              console.log("✅ Video uploaded successfully");
            }
          } catch (e) {
            console.error("❌ Error saving interview recording:", e);
          } finally {
            setIsUploadingVideo(false);
          }
        };
      } else {
        console.warn("⚠️ Media recording features are disabled because MediaRecorder could not be initialized.");
      }

      setHasAgreed(true);
      setShowIdVerification(true);
    } catch (err: any) {
      console.error("❌ Failed to acquire real media streams:", err);
      
      // Show user-friendly error message
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setGeneralError('Camera/Microphone permission denied. Please allow access in browser settings and try again.');
        return;
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setGeneralError('No camera or microphone found. Please check your device.');
        return;
      } else if (err.name === 'NotReadableError') {
        setGeneralError('Camera/Microphone is in use by another application. Please close it and try again.');
        return;
      }
      
      console.warn("Attempting fallback to synthetic MediaStream...", err);
      
      // 1. Create a synthetic canvas video track
      let videoTrack: MediaStreamTrack | null = null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        
        let angle = 0;
        const drawMockFeed = () => {
          if (!ctx) return;
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, 640, 480);
          
          ctx.strokeStyle = "#1e293b";
          ctx.lineWidth = 1;
          for (let i = 0; i < 640; i += 40) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 480); ctx.stroke();
          }
          for (let j = 0; j < 480; j += 40) {
            ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(640, j); ctx.stroke();
          }

          const radius = 80 + Math.sin(angle) * 10;
          ctx.strokeStyle = "#6366f1";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(320, 240, radius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = "#4f46e5";
          ctx.beginPath(); ctx.moveTo(320, 200); ctx.lineTo(320, 280); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(280, 240); ctx.lineTo(360, 240); ctx.stroke();

          ctx.fillStyle = "#e2e8f0";
          ctx.font = "bold 16px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("SIMULATED PROCTOR FEED", 320, 100);
          
          ctx.fillStyle = "#a5b4fc";
          ctx.font = "10px monospace";
          ctx.fillText(`STATUS: ACTIVE | MOCKED | TIME: ${new Date().toLocaleTimeString()}`, 320, 380);

          angle += 0.05;
          if (streamRef.current) {
            requestAnimationFrame(drawMockFeed);
          }
        };
        drawMockFeed();
        
        const canvasStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : (canvas as any).webkitCaptureStream(30);
        videoTrack = canvasStream.getVideoTracks()[0];
      } catch (videoErr) {
        console.error("Failed to generate mock video track:", videoErr);
      }

      // 2. Create a synthetic audio track (silent oscillator)
      let audioTrack: MediaStreamTrack | null = null;
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const dest = audioCtx.createMediaStreamDestination();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.001; 
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        audioTrack = dest.stream.getAudioTracks()[0];
      } catch (audioErr) {
        console.error("Failed to generate mock audio track:", audioErr);
      }

      // 3. Combine tracks into a new MediaStream
      const tracks: MediaStreamTrack[] = [];
      if (videoTrack) tracks.push(videoTrack);
      if (audioTrack) tracks.push(audioTrack);
      
      const mockStream = new MediaStream(tracks);
      streamRef.current = mockStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mockStream;
        videoRef.current.play().catch(e => console.debug("Mock video play triggered", e));
      }

      // 4. Initialize MediaRecorder on the mock stream
      try {
        const mediaRecorder = createMediaRecorder(mockStream);
        if (mediaRecorder) {
          mediaRecorderRef.current = mediaRecorder;
          chunksRef.current = [];
          mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = async () => {
            setIsUploadingVideo(true);
            try {
              const recordingDuration = recordingStartTimeRef.current 
                ? (Date.now() - recordingStartTimeRef.current) / 1000 
                : 0;

              const videoBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'video/webm' });
              const formData = new FormData();
              formData.append('video', videoBlob, `${resumeId}.webm`);
              if (recordingDuration > 0) {
                formData.append('duration', recordingDuration.toFixed(1));
              }
              const uploadRes = await fetch(`/api/interview/${resumeId}/upload_video`, {
                method: 'POST',
                body: formData
              });
              if (!uploadRes.ok) {
                const errorData = await uploadRes.json();
                console.error("❌ Failed to upload recording file. Status:", uploadRes.status, "Error:", errorData);
              } else {
                console.log("✅ Video uploaded successfully");
              }
            } catch (e) {
              console.error("❌ Error saving interview recording:", e);
            } finally {
              setIsUploadingVideo(false);
            }
          };
        } else {
          console.warn("⚠️ Media recording features are disabled on mock stream because MediaRecorder could not be initialized.");
        }
      } catch (recErr) {
        console.error("Failed to initialize MediaRecorder on mock stream:", recErr);
      }

      setHasAgreed(true);
      setShowIdVerification(true);
    }
  };

  const startInterview = async () => {
    setShowStartConfirm(false);
    
    // Mark interview as started in database
    try {
      await fetch(`/api/interview/${resumeId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.warn("Failed to mark interview as started:", err);
    }
    
    // Ensure video stream is synced and playing
    if (videoRef.current) {
      if (streamRef.current && videoRef.current.srcObject !== streamRef.current) {
        console.log("🔄 Reassigning stream in startInterview...");
        videoRef.current.srcObject = streamRef.current;
      }
      // Force play with timeout to ensure browser has rendered
      setTimeout(async () => {
        if (videoRef.current && videoRef.current.srcObject) {
          try {
            await videoRef.current.play();
            console.log("✅ Video forcefully played in startInterview");
          } catch (e) {
            console.warn("⚠️ Video play failed in startInterview:", e);
          }
        }
      }, 100);
    }
    
    // Request fullscreen
    const docEl = document.documentElement;
    let fullscreenActivated = false;
    try {
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
        fullscreenActivated = true;
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen();
        fullscreenActivated = true;
      } else if ((docEl as any).msRequestFullscreen) {
        await (docEl as any).msRequestFullscreen();
        fullscreenActivated = true;
      }
    } catch (err) {
      console.error("Fullscreen activation failed or denied:", err);
    }

    if (!fullscreenActivated) {
      setShowFullscreenRequired(true);
      setIsFullscreenActive(false);
    } else {
      setIsFullscreenActive(true);
      setShowFullscreenRequired(false);
    }

    setCurrentStep('intro');
    
    // Ensure video is playing
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.play().catch(e => console.warn("Video play error in startInterview:", e));
    }
    
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state === 'inactive') {
          mediaRecorderRef.current.start(1000);
          setIsRecording(true);
          recordingStartTimeRef.current = Date.now();
        } else {
          console.warn("MediaRecorder already in", mediaRecorderRef.current.state, "state, not starting");
        }
      } catch (err) {
        console.error("Error starting media recorder:", err);
      }
    }
    
    startTimer();
    
    if (streamRef.current) {
      setupAudioAnalyser(streamRef.current);
    }
    
    setupSpeechRecognition();
    
    // Speak introduction question
    speakQuestion("Welcome to the assessment. Please introduce yourself and summarize your professional background.");
  };


  const cycleProctorState = () => {
    setProctorState(prev => {
      if (prev === 'one') return 'none';
      if (prev === 'none') return 'multiple';
      if (prev === 'multiple') return 'phone';
      return 'one';
    });
  };

  const cancelStartConfirm = () => {
    setShowStartConfirm(false);
    setCurrentStep('setup');
    setHasAgreed(false);
    setIsRecording(false);
    recordingStartTimeRef.current = null;
    
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.error("Error stopping stream tracks:", err);
      }
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current = null;
    }
  };

  const setupAudioAnalyser = (stream: MediaStream) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let excessiveNoiseStart = 0;
      let multipleVoicesStart = 0;
      let backgroundConversationStart = 0;

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Map average amplitude to a readable 0-100 scale
        const volume = Math.min(100, Math.round((average / 128) * 100));
        setUserVolume(volume);
        
        const activeListening = isMicListeningRef.current;
        setIsUserSpeaking(volume > 5 && activeListening);

        if (activeListening) {
          const now = Date.now();

          // Excessive Noise check (volume > 85, duration >= 2.5s)
          if (volume > 85) {
            if (!excessiveNoiseStart) excessiveNoiseStart = now;
            const duration = (now - excessiveNoiseStart) / 1000;
            if (duration >= 2.5) {
              triggerProctorEvent("Excessive Noise", duration, 0.95, "Excessive ambient noise or sound levels detected.");
              excessiveNoiseStart = now; // reset start time to prevent spamming
            }
          } else {
            excessiveNoiseStart = 0;
          }

          // Multiple Voices check (volume > 65, duration >= 3.5s)
          if (volume > 65) {
            if (!multipleVoicesStart) multipleVoicesStart = now;
            const duration = (now - multipleVoicesStart) / 1000;
            if (duration >= 3.5) {
              triggerProctorEvent("Multiple Voices Detected", duration, 0.90, "Multiple distinct speaking voices detected in candidate vicinity.");
              multipleVoicesStart = now;
            }
          } else {
            multipleVoicesStart = 0;
          }

          // Background Conversation check (volume > 25, duration >= 5s)
          if (volume > 25) {
            if (!backgroundConversationStart) backgroundConversationStart = now;
            const duration = (now - backgroundConversationStart) / 1000;
            if (duration >= 5.0) {
              triggerProctorEvent("Background Conversation", duration, 0.80, "Sustained secondary talking or background conversation detected.");
              backgroundConversationStart = now;
            }
          } else {
            backgroundConversationStart = 0;
          }
        } else {
          excessiveNoiseStart = 0;
          multipleVoicesStart = 0;
          backgroundConversationStart = 0;
        }

        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (err) {
      console.error("Error setting up audio analyser:", err);
    }
  };

  const getErrorMessage = (err: string) => {
    switch (err) {
      case 'network':
        return 'Network connection failed. Google Chrome/MS Edge Speech Recognition requires internet access to process voice cloud-side. Please check your network connection or type manually.';
      case 'not-allowed':
      case 'permission-denied':
        return 'Microphone permission was denied. Please allow microphone access in your browser settings and unmute to try again.';
      case 'service-not-allowed':
        return 'Speech recognition service is not allowed by your browser or system policies. Please type manually.';
      case 'no-speech':
        return 'No speech was detected. Please check your microphone or try speaking again.';
      case 'audio-capture':
        return 'Microphone capture failed. Ensure your mic is connected and not in use by another app.';
      default:
        return `Speech recognition issue: ${err}. Please type your response manually.`;
    }
  };

  const setupSpeechRecognition = () => {
    if (!SpeechRecognition) {
      console.warn("Speech Recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsMicListening(true);
      setRecognitionError(null);
    };

    recognition.onresult = (event: any) => {
      // If we are on a coding question, ignore all live transcription to avoid overwriting code
      if (isCodingQuestionRef.current) return;

      let fullTranscript = '';
      for (let i = 0; i < event.results.length; ++i) {
        fullTranscript += event.results[i][0].transcript;
      }
      setAnswer(fullTranscript);
    };

    recognition.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      if (event.error === 'no-speech') return;
      
      // Stop loop restarts by toggling mic off
      setRecognitionError(event.error);
      setIsMicListening(false);
      isMicListeningRef.current = false;
      
      try {
        recognition.stop();
      } catch (e) {}
    };

    recognition.onend = () => {
      // Re-start recognition continuously if mic should be active
      if (isMicListeningRef.current && !interviewEnded) {
        try {
          recognition.start();
        } catch (e) {
          console.debug("Failed to restart speech recognition:", e);
        }
      } else {
        setIsMicListening(false);
      }
    };

    recognitionRef.current = recognition;
  };

  const startListening = () => {
    if (!SpeechRecognition) return;
    if (isCodingQuestionRef.current) return;
    setRecognitionError(null);
    setIsMicListening(true);
    isMicListeningRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.debug("Start speech recognition error:", err);
      }
    }
  };


  const toggleMic = () => {
    if (isCodingQuestionRef.current) return;
    if (isMicListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startTimer = () => {
    timerIdRef.current = window.setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          stopTimer();
          finalizeInterview();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };


  const pickEnglishVoice = () => {
    if (!window.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;
    return voices.find(v => v.default && /^en/i.test(v.lang || '')) ||
           voices.find(v => /^en-us/i.test(v.lang || '')) ||
           voices.find(v => /^en-gb/i.test(v.lang || '')) ||
           voices.find(v => /^en/i.test(v.lang || '')) || null;
  };

  const speakQuestion = (text: string) => {
    if (!window.speechSynthesis || !text) return;
    
    // Stop recording mic input while AI is speaking
    stopListening();

    const isCodingText = text.startsWith("Coding Challenge:");

    let spoken = false;
    const doSpeak = () => {
      if (spoken || interviewEnded) return;
      spoken = true;
      speechSynthesis.cancel();
      
      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickEnglishVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang || 'en-US';
      } else {
        utter.lang = 'en-US';
      }

      utter.onstart = () => {
        setIsAiSpeaking(true);
      };

      utter.onend = () => {
        setIsAiSpeaking(false);
        // Automatically start listing when AI finishes speaking, unless it's a coding question
        if (!isCodingText) {
          startListening();
        }
      };

      utter.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') {
          console.warn(`Speech synthesis ${e.error}`);
        } else {
          console.error("Speech synthesis error:", e.error || e);
        }
        setIsAiSpeaking(false);
        // Start listening anyway, unless it's a coding question
        if (!isCodingText) {
          startListening();
        }
      };

      speechSynthesis.speak(utter);
    };

    if (speechSynthesis.getVoices().length) {
      doSpeak();
    } else {
      const onV = () => {
        speechSynthesis.removeEventListener('voiceschanged', onV);
        doSpeak();
      };
      speechSynthesis.addEventListener('voiceschanged', onV);
      setTimeout(doSpeak, 250);
    }
  };


  const handleSkip = async () => {
    if (interviewEnded || secondsLeft <= 0 || isSubmitting || currentStep !== 'questions') return;
    setIsSubmitting(true);
    stopListening();
    
    try {
      const res = await fetch(`/api/interview/${resumeId}/submit_answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_index: currentIndex,
          question: questions[currentIndex],
          answer: "[Skipped]"
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'success') {
        setGeneralError(body.message || `Skip failed (${res.status}). Please try again.`);
        setIsSubmitting(false);
        // Resume listening if failed
        startListening();
        return;
      }

      setSubmittedAnswers(prev => ({
        ...prev,
        [currentIndex]: "[Skipped]"
      }));

      if (currentIndex >= questions.length - 1) {
        setCurrentStep('candidate_question');
        setAnswer('');
        speakQuestion("Do you have any questions for the BizX HR Team?");
      } else {
        const nextIndex = currentIndex + 1;
        setCurrentIndex(nextIndex);
        setAnswer('');
        speakQuestion(questions[nextIndex]);
      }
    } catch (err) {
      setGeneralError('Network error. Check your connection and try again.');
      // Resume listening if failed
      startListening();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = async (forceSubmit = false) => {
    if (interviewEnded || secondsLeft <= 0 || isSubmitting) return;

    // Check if submitting coding question without running
    const isCoding = currentStep === 'questions' && questions[currentIndex]?.startsWith("Coding Challenge:");
    if (isCoding && !terminalOutput && !forceSubmit) {
      setShowSubmitWithoutRunConfirm(true);
      return;
    }

    setIsSubmitting(true);
    
    // Temporarily stop listening during API call & transition
    stopListening();

    let submitIndex = currentIndex;
    let submitQuestion = questions[currentIndex] || "";
    if (currentStep === 'intro') {
      submitIndex = -1;
      submitQuestion = "Please introduce yourself and summarize your professional background.";
    } else if (currentStep === 'candidate_question') {
      submitIndex = -2;
      submitQuestion = "Do you have any questions for the BizX HR Team?";
    }

    try {
      const res = await fetch(`/api/interview/${resumeId}/submit_answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_index: submitIndex,
          question: submitQuestion,
          answer: answer
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'success') {
        setGeneralError(body.message || `Save failed (${res.status}). Please try again.`);
        setIsSubmitting(false);
        // Resume listening if failed
        startListening();
        return;
      }

      setSubmittedAnswers(prev => ({
        ...prev,
        [submitIndex]: answer
      }));

      if (currentStep === 'intro') {
        setCurrentStep('questions');
        setAnswer('');
        if (questions.length > 0) {
          speakQuestion(questions[0]);
        } else {
          // If no questions loaded, skip directly
          setCurrentStep('candidate_question');
          speakQuestion("Do you have any questions for the BizX HR Team?");
        }
      } else if (currentStep === 'questions') {
        if (currentIndex >= questions.length - 1) {
          setCurrentStep('candidate_question');
          setAnswer('');
          speakQuestion("Do you have any questions for the BizX HR Team?");
        } else {
          const nextIndex = currentIndex + 1;
          setCurrentIndex(nextIndex);
          setAnswer('');
          speakQuestion(questions[nextIndex]);
        }
      } else if (currentStep === 'candidate_question') {
        setShowReviewModal(true);
      }
    } catch (err) {
      setGeneralError('Network error. Check your connection and try again.');
      // Resume listening if failed
      startListening();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNavigateToSection = async (
    targetStep: 'intro' | 'questions' | 'candidate_question',
    targetIndex: number = 0,
    forceSubmit = false
  ) => {
    if (interviewEnded || secondsLeft <= 0 || isSubmitting) return;

    if (currentStep === targetStep) {
      if (targetStep !== 'questions' || targetIndex === currentIndex) return;
    }

    // Check if leaving a coding question without running
    const isCoding = currentStep === 'questions' && questions[currentIndex]?.startsWith("Coding Challenge:");
    const isNavigatingAwayFromCoding = isCoding && (targetStep !== 'questions' || targetIndex !== currentIndex);
    if (isNavigatingAwayFromCoding && !terminalOutput && !forceSubmit) {
      setPendingNavigation({ step: targetStep, index: targetIndex });
      setShowSubmitWithoutRunConfirm(true);
      return;
    }

    setIsSubmitting(true);
    stopListening();
    if (window.speechSynthesis) speechSynthesis.cancel();

    // Prepare what we are saving
    let submitIndex = currentIndex;
    let submitQuestion = "";
    if (currentStep === 'intro') {
      submitIndex = -1;
      submitQuestion = "Please introduce yourself and summarize your professional background.";
    } else if (currentStep === 'candidate_question') {
      submitIndex = -2;
      submitQuestion = "Do you have any questions for the BizX HR Team?";
    } else {
      submitIndex = currentIndex;
      submitQuestion = questions[currentIndex] || "";
    }

    const answerToSave = answer;

    try {
      await fetch(`/api/interview/${resumeId}/submit_answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_index: submitIndex,
          question: submitQuestion,
          answer: answerToSave
        })
      });

      // Update local cache state
      setSubmittedAnswers(prev => ({
        ...prev,
        [submitIndex]: answerToSave
      }));

      // Switch to the target section
      setCurrentStep(targetStep);
      if (targetStep === 'questions') {
        setCurrentIndex(targetIndex);
      }

      // Explicitly set target answer to avoid race conditions with useEffect
      if (targetStep === 'intro') {
        setAnswer(submittedAnswers[-1] !== undefined ? submittedAnswers[-1] : "");
        speakQuestion("Welcome to the assessment. Please introduce yourself and summarize your professional background.");
      } else if (targetStep === 'candidate_question') {
        setAnswer(submittedAnswers[-2] !== undefined ? submittedAnswers[-2] : "");
        speakQuestion("Do you have any questions for the BizX HR Team?");
      } else {
        const cached = submittedAnswers[targetIndex];
        const isTargetCoding = questions[targetIndex]?.startsWith("Coding Challenge:");
        if (cached !== undefined) {
          setAnswer(cached);
        } else {
          if (isTargetCoding) {
            setAnswer(DEFAULT_TEMPLATES[selectedLanguage] || "");
          } else {
            setAnswer('');
          }
        }
        speakQuestion(questions[targetIndex]);
      }
    } catch (err) {
      console.error("Navigation error:", err);
      // Fallback navigation in case of fetch/network error
      setCurrentStep(targetStep);
      if (targetStep === 'questions') {
        setCurrentIndex(targetIndex);
      }

      if (targetStep === 'intro') {
        setAnswer(submittedAnswers[-1] !== undefined ? submittedAnswers[-1] : "");
        speakQuestion("Welcome to the assessment. Please introduce yourself and summarize your professional background.");
      } else if (targetStep === 'candidate_question') {
        setAnswer(submittedAnswers[-2] !== undefined ? submittedAnswers[-2] : "");
        speakQuestion("Do you have any questions for the BizX HR Team?");
      } else {
        const cached = submittedAnswers[targetIndex];
        const isTargetCoding = questions[targetIndex]?.startsWith("Coding Challenge:");
        if (cached !== undefined) {
          setAnswer(cached);
        } else {
          if (isTargetCoding) {
            setAnswer(DEFAULT_TEMPLATES[selectedLanguage] || "");
          } else {
            setAnswer('');
          }
        }
        speakQuestion(questions[targetIndex]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunCode = async () => {
    if (isRunningCode || isSubmitting) return;
    setIsRunningCode(true);
    setTerminalOutput(null);

    try {
      const res = await fetch(`/api/interview/${resumeId}/run_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_index: currentIndex,
          question: questions[currentIndex],
          language: selectedLanguage,
          code: answer
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTerminalOutput(data);
      } else {
        setTerminalOutput({
          compiles: false,
          error: data.error || "Sandbox error: failed to run code.",
          testCases: [],
          score: 0
        });
      }
    } catch (err: any) {
      console.error(err);
      setTerminalOutput({
        compiles: false,
        error: `Network error: ${err.message || 'could not connect to code evaluation service.'}`,
        testCases: [],
        score: 0
      });
    } finally {
      setIsRunningCode(false);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  };

  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const value = e.currentTarget.value;
      
      const newValue = value.substring(0, start) + "  " + value.substring(end);
      setAnswer(newValue);
      
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  const lineCount = answer.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1);

  const progressValue = currentStep === 'intro' 
    ? 0 
    : currentStep === 'candidate_question' 
      ? 100 
      : questions.length 
        ? Math.round(((currentIndex + 1) / questions.length) * 100) 
        : 0;

  return (
    <div className={`min-h-screen bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#e0e7ff] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-300 ${(currentStep === 'questions' || currentStep === 'candidate_question') ? 'select-none' : ''}`}>
      {/* Floating ThemeToggle above modals for setup screen access */}
      {(!hasAgreed || showStartConfirm) && (
        <div className="fixed top-4 right-4 z-[110]">
          <ThemeToggle />
        </div>
      )}

      {/* Dynamic Keyframes Injection */}
      <style>{`
        @keyframes equalizer {
          0%, 100% { height: 4px; }
          50% { height: 24px; }
        }
        .animate-equalizer {
          animation: equalizer 0.8s ease-in-out infinite;
        }
        @keyframes ripple {
          0% { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .animate-ripple {
          animation: ripple 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
      `}</style>

      {/* Header */}
      <nav className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-indigo-50/80 dark:border-slate-800 py-3 md:py-4 px-4 md:px-6 shadow-sm sticky top-0 z-50 transition-colors">
        <div className="max-w-full mx-auto px-2 md:px-6 flex flex-wrap items-center justify-between gap-3 md:gap-4">
          <div className="flex items-center gap-2 md:gap-3">
            <h1 className="text-lg md:text-xl font-black bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent tracking-tight">Voice Interview</h1>
            <Badge className="hidden sm:inline-flex bg-indigo-50 dark:bg-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-100 dark:hover:bg-slate-700 border-0 font-bold px-3 py-1">Confidential Session</Badge>
          </div>
          <div className="flex items-center gap-2 md:gap-4 flex-wrap justify-end">
            <div className="flex items-center gap-1.5 pr-2 border-r border-indigo-100 dark:border-slate-800">
              <Link href="/">
                <Button size="sm" variant="ghost" className="text-slate-500 dark:text-slate-400 hover:text-indigo-700 dark:hover:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-2.5 md:px-3 font-semibold text-xs md:text-sm">
                  <span className="hidden sm:inline">Candidate Screening Report</span>
                  <span className="inline sm:hidden">Home</span>
                </Button>
              </Link>
              <ThemeToggle />
              {hasAgreed && !interviewEnded && (
                <Button 
                  onClick={() => setShowEndConfirm(true)} 
                  size="sm" 
                  className="rounded-xl bg-red-600 hover:bg-red-700 dark:bg-rose-600 dark:hover:bg-rose-700 text-white font-bold px-2.5 md:px-3 transition-all ml-1 md:ml-1.5 shadow-sm text-xs md:text-sm"
                >
                  End Test
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2.5 md:gap-6 flex-wrap">

              <div className="flex items-center gap-2 md:gap-3 bg-indigo-50 dark:bg-slate-850 rounded-full pl-3 md:pl-4 pr-1.5 py-1 md:py-1.5 border border-indigo-100 dark:border-slate-700">
                <span className="text-indigo-500 dark:text-violet-400 text-[9px] md:text-[10px] font-extrabold uppercase tracking-widest">Remaining</span>
                <div className="bg-gradient-to-r from-red-500 to-rose-600 text-white font-mono font-bold text-xs md:text-sm px-2.5 py-0.5 md:py-1 rounded-full shadow-md shadow-red-500/25" aria-live="polite">
                  {formatTime(Math.max(0, secondsLeft))}
                </div>
              </div>
              <div className="hidden lg:flex items-center gap-2 text-emerald-500">
                <ShieldAlert className="w-4 h-4 animate-pulse" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest">Secure</span>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {generalError && (
        <div className="max-w-7xl mx-auto px-4 md:px-6 mt-4">
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 px-4 py-3 rounded-2xl flex items-center gap-3.5 shadow-sm animate-fade-in text-sm font-semibold">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <span className="flex-grow">{generalError}</span>
            <button onClick={() => setGeneralError(null)} className="text-red-400 hover:text-red-650 font-bold ml-auto px-1.5 text-xs">✕</button>
          </div>
        </div>
      )}

      {/* Resume Session Modal */}
      {hasSavedSession && !isInitializing && !interviewEnded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-lg w-full p-8 shadow-2xl border border-indigo-100 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 to-violet-500" />
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-6">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-4 text-center">Resume Active Assessment</h2>
            <p className="text-slate-600 dark:text-slate-350 font-bold mb-6 text-center leading-relaxed text-sm">
              We detected an active interview session in progress for you. Click below to re-enable your camera/microphone and resume from where you left off.
            </p>
            <div className="bg-indigo-50 dark:bg-slate-900/60 border border-indigo-100 dark:border-slate-800 text-indigo-700 dark:text-violet-400 p-5 rounded-2xl flex items-center gap-3.5 mb-8">
              <Camera className="w-6 h-6 text-indigo-500 flex-shrink-0" />
              <p className="text-sm font-black leading-snug">Restoring session details will automatically resume your assessment progress and timer.</p>
            </div>
            <div className="flex flex-wrap gap-4 justify-center">
              <Button onClick={handleResumeSession} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white gap-2 rounded-2xl px-6 font-bold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all w-full">
                Resume Assessment <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Agreement Modal */}
      {!hasSavedSession && !hasAgreed && !isInitializing && !interviewEnded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-lg w-full p-8 shadow-2xl border border-indigo-100 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 to-violet-500" />
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-6">
              <ShieldAlert className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-4 text-center">Terms & Recording Agreement</h2>
            <p className="text-slate-600 dark:text-slate-350 font-bold mb-6 text-center leading-relaxed text-sm">
              By proceeding, you consent to having your <strong className="text-red-500 dark:text-red-400 font-extrabold">audio and video recorded</strong> for the duration of this interview.
              The recording will be used strictly for assessment purposes by the administrative team.
            </p>
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-300 p-5 rounded-2xl flex items-center gap-3.5 mb-8">
              <Mic className="w-6 h-6 text-red-500 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm font-black leading-snug">You will be prompted to grant browser permissions for your camera and microphone.</p>
            </div>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/">
                <Button variant="outline" className="rounded-2xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold">Cancel</Button>
              </Link>
              <Button onClick={handleAgreeAndStart} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white gap-2 rounded-2xl px-6 font-bold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all">
                I Agree, Start Interview <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Identity Verification Modal */}
      {showIdVerification && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto"
        >
          <Card className="max-w-2xl w-full p-8 shadow-2xl border border-indigo-150 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl flex flex-col my-8">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            
            <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">Identity Verification</h2>
                <p className="text-xs text-slate-550 dark:text-slate-400 font-bold uppercase tracking-wider mt-0.5">AI Biometric Identity Portal</p>
              </div>
            </div>

            {/* Stepper progress indicator */}
            {!verificationResult && !isVerifying && (
              <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center gap-2 flex-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${!idImageBase64 ? 'bg-indigo-600 text-white' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'}`}>
                    1
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Government ID</span>
                </div>
                <div className="h-0.5 bg-slate-200 dark:bg-slate-800 flex-1" />
                <div className="flex items-center gap-2 flex-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${idImageBase64 ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                    2
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-355">Selfie Capture</span>
                </div>
              </div>
            )}

            {/* STEP 1: Government ID Capture */}
            {!idImageBase64 && (
              <div className="space-y-6">
                <div className="text-left">
                  <h3 className="text-sm font-black text-slate-855 dark:text-slate-200 uppercase tracking-wider mb-2">Step 1: Capture or Upload Government ID</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-semibold">
                    Please hold your Government ID (Driver's License, Passport, or National ID card) up to the camera or upload a scanned image file. Ensure all details are clearly legible and the face photo on the ID is fully visible.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Webcam Snap Panel */}
                  <div className="flex flex-col gap-3">
                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest text-left">Camera Capture</span>
                    <div className="relative aspect-video rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-850 bg-slate-950 flex flex-col items-center justify-center shadow-inner">
                      <video
                        ref={verificationVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                      />
                      <div className="absolute inset-0 border-[3px] border-dashed border-indigo-500/50 m-6 rounded-xl flex items-center justify-center pointer-events-none">
                        <span className="text-[9px] text-indigo-300 font-extrabold uppercase bg-slate-950/80 px-2 py-0.5 rounded tracking-wider">Align ID within frame</span>
                      </div>
                      <Button
                        onClick={() => captureImageFromWebcam('id')}
                        className="absolute bottom-3 bg-indigo-600/90 hover:bg-indigo-700 text-white font-bold rounded-xl px-4 py-2 gap-2 text-xs backdrop-blur-sm z-10 shadow-lg"
                      >
                        <Camera className="w-3.5 h-3.5" /> Capture ID Photo
                      </Button>
                    </div>
                  </div>

                  {/* File Upload Panel */}
                  <div className="flex flex-col gap-3">
                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest text-left">File Upload Fallback</span>
                    <div className="flex-1 flex flex-col justify-center items-center p-6 border-2 border-dashed border-slate-250 dark:border-slate-800 rounded-2xl bg-slate-50 dark:bg-slate-950/40 text-center relative hover:bg-slate-100 dark:hover:bg-slate-950/60 transition-colors group aspect-video min-h-[140px] md:min-h-0">
                      <Upload className="w-8 h-8 text-indigo-500 group-hover:scale-110 transition-transform mb-2" />
                      <span className="text-xs font-extrabold text-slate-700 dark:text-slate-300">Choose ID Scan File</span>
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 mt-1 font-semibold">Accepts PNG, JPG, JPEG (Max 5MB)</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleIdFileUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-start border-t border-slate-100 dark:border-slate-800 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowIdVerification(false);
                      setHasAgreed(false);
                    }}
                    className="rounded-xl border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-805 font-bold px-5 text-xs"
                  >
                    Go Back
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: Live Selfie Capture */}
            {idImageBase64 && !selfieImageBase64 && (
              <div className="space-y-6">
                <div className="text-left">
                  <h3 className="text-sm font-black text-slate-855 dark:text-slate-200 uppercase tracking-wider mb-2">Step 2: Capture Live Selfie</h3>
                  <p className="text-xs text-slate-655 dark:text-slate-350 leading-relaxed font-semibold">
                    Look directly into your webcam. Ensure your face is well-lit, fully visible, and not covered by hats, hands, or severe shadows. Click "Capture Selfie" when ready.
                  </p>
                </div>

                <div className="relative aspect-video max-w-md mx-auto w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-850 bg-slate-950 flex flex-col items-center justify-center shadow-lg">
                  <video
                    ref={verificationVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute inset-0 border-[3px] border-dashed border-indigo-500/50 m-8 rounded-full flex items-center justify-center pointer-events-none">
                    <span className="text-[9px] text-indigo-300 font-extrabold uppercase bg-slate-950/80 px-2 py-0.5 rounded tracking-wider">Position Face Here</span>
                  </div>
                  <Button
                    onClick={() => captureImageFromWebcam('selfie')}
                    className="absolute bottom-3 bg-indigo-600/90 hover:bg-indigo-700 text-white font-bold rounded-xl px-4 py-2 gap-2 text-xs backdrop-blur-sm z-10 shadow-lg"
                  >
                    <Camera className="w-3.5 h-3.5" /> Capture Selfie
                  </Button>
                </div>

                <div className="flex items-center justify-between mt-4 p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-2xl border border-slate-150 dark:border-slate-850">
                  <div className="flex items-center gap-3">
                    <img src={idImageBase64} className="w-14 h-10 object-cover rounded-lg border border-slate-250 dark:border-slate-700" alt="Captured ID" />
                    <div className="text-left">
                      <span className="block text-xs font-black text-slate-800 dark:text-slate-200">Government ID Saved</span>
                      <span className="block text-[9px] text-emerald-500 dark:text-emerald-400 font-extrabold uppercase tracking-wider mt-0.5">Ready for verification</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIdImageBase64(null);
                      setVerificationError(null);
                    }}
                    className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 font-bold px-3 py-1.5 h-auto rounded-xl transition-all"
                  >
                    Change ID
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: Verification Running / Results */}
            {idImageBase64 && selfieImageBase64 && (
              <div>
                {/* 3A. Verification in progress spinner */}
                {isVerifying && (
                  <div className="flex flex-col items-center py-12 text-center">
                    <div className="relative mb-6">
                      <Loader2 className="w-14 h-14 text-indigo-500 animate-spin" />
                      <Sparkles className="w-6 h-6 text-purple-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                    </div>
                    <h3 className="text-lg font-black text-slate-855 dark:text-slate-100">Comparing Biometric Signatures...</h3>
                    <p className="text-xs text-slate-550 dark:text-slate-400 mt-2 max-w-sm font-semibold leading-relaxed">
                      AI is evaluating facial geometry, mapping features from the ID card to the live selfie, and checking authenticity. This will take just a few seconds.
                    </p>
                  </div>
                )}

                {/* 3B. Verification Failed details block */}
                {!isVerifying && verificationResult && !verificationResult.matched && (
                  <div className="flex flex-col items-center py-4 text-center">
                    {(verificationResult as any).isSystemError ? (
                      <>
                        <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 flex items-center justify-center text-amber-500 dark:text-amber-400 mb-4">
                          <AlertCircle className="w-7 h-7" />
                        </div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">
                          {showManualCheckNotice ? "Manual Verification Required" : "Verification System Busy"}
                        </h3>
                        
                        <div className="my-4 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-150 dark:border-amber-900/30 text-amber-800 dark:text-amber-350 text-xs font-semibold leading-relaxed text-left w-full">
                          <strong className="block mb-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-450">
                            {showManualCheckNotice ? "Manual Check Notice:" : "System Load Notice:"}
                          </strong>
                          {showManualCheckNotice 
                            ? "The biometric verification process is taking longer than expected. A manual check will be conducted. Your Government ID and Selfie snapshot have been saved for review. You may proceed to the assessment."
                            : "The automated matching service is temporarily busy. Your Government ID and Selfie snapshot have been successfully saved for manual verification by the recruiter. You may proceed to the assessment instructions."
                          }
                        </div>

                        <div className="grid grid-cols-2 gap-4 my-6 w-full max-w-md">
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Government ID</span>
                            <img src={idImageBase64} className="w-full aspect-video object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" />
                          </div>
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Captured Selfie</span>
                            <img src={selfieImageBase64} className="w-full aspect-video object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" />
                          </div>
                        </div>

                        <div className="flex gap-4 pt-4 border-t border-slate-100 dark:border-slate-800 w-full justify-center">
                          <Button
                            onClick={() => {
                              setIdImageBase64(null);
                              setSelfieImageBase64(null);
                              setVerificationResult(null);
                              setVerificationError(null);
                            }}
                            variant="outline"
                            className="rounded-2xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold text-xs"
                          >
                            Retry Capture
                          </Button>
                          <Button
                            onClick={() => {
                              setShowIdVerification(false);
                              setShowStartConfirm(true);
                            }}
                            className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold rounded-2xl px-6 py-2.5 shadow-md shadow-indigo-500/25 transition-all text-xs flex items-center gap-1.5"
                          >
                            Proceed anyway <ArrowRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-955/20 border border-rose-250 dark:border-rose-900/40 flex items-center justify-center text-rose-500 dark:text-rose-455 mb-4">
                          <AlertCircle className="w-7 h-7" />
                        </div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">Verification Rejected</h3>
                        <span className="text-xs bg-rose-100 dark:bg-rose-950/45 text-rose-700 dark:text-rose-400 px-3 py-0.5 rounded-full font-black mt-1">
                          Match Confidence: {verificationResult.confidence}%
                        </span>
                        
                        <div className="my-4 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-150 dark:border-rose-900/30 text-rose-700 dark:text-rose-350 text-xs font-semibold leading-relaxed text-left w-full">
                          <strong className="block mb-1 text-[10px] font-black uppercase tracking-wider text-rose-800 dark:text-rose-450">Assessment Feedback:</strong>
                          {verificationResult.reason}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 my-6 w-full max-w-md">
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Government ID</span>
                            <img src={idImageBase64} className="w-full aspect-video object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" />
                          </div>
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Captured Selfie</span>
                            <img src={selfieImageBase64} className="w-full aspect-video object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" />
                          </div>
                        </div>

                        <Button
                          onClick={() => {
                            setIdImageBase64(null);
                            setSelfieImageBase64(null);
                            setVerificationResult(null);
                            setVerificationError(null);
                          }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl px-6 py-2.5 shadow-md shadow-indigo-500/25 transition-all text-xs"
                        >
                          Retry Capture Flow
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* 3C. Verification Success badge */}
                {!isVerifying && verificationResult?.matched && (
                  <div className="flex flex-col items-center py-4 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 flex items-center justify-center text-emerald-650 dark:text-emerald-400 mb-4 animate-bounce">
                      <ShieldCheck className="w-7 h-7" />
                    </div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">Identity Verified</h3>
                    <span className="text-xs bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 px-3.5 py-0.5 rounded-full font-black mt-1">
                      Biometric Match Confidence: {verificationResult.confidence}%
                    </span>

                    <div className="my-4 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-150 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-355 text-xs font-semibold leading-relaxed text-left w-full">
                      <strong className="block mb-1 text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-450">Biometric Matching Rationale:</strong>
                      {verificationResult.reason}
                    </div>

                    <div className="grid grid-cols-2 gap-4 my-6 w-full max-w-md">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Government ID</span>
                        <img src={idImageBase64} className="w-full aspect-video object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" />
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Captured Selfie</span>
                        <img src={selfieImageBase64} className="w-full aspect-video object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" />
                      </div>
                    </div>

                    <Button
                      onClick={() => {
                        setShowIdVerification(false);
                        setShowStartConfirm(true);
                      }}
                      className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold rounded-2xl px-8 py-3 shadow-md shadow-indigo-500/25 flex items-center gap-2 text-xs"
                    >
                      Proceed to Assessment Instructions <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {/* 3D. Unverified Confirmation review screen */}
                {!isVerifying && !verificationResult && (
                  <div className="flex flex-col items-center py-4 text-center">
                    <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">Confirm Captured Images</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold">
                      Review both pictures to verify that your ID is clear and your face is well-aligned.
                    </p>

                    <div className="grid grid-cols-2 gap-6 my-6 w-full max-w-lg">
                      <div className="flex flex-col items-center gap-2 relative">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Government ID</span>
                        <img src={idImageBase64} className="w-full aspect-video object-cover rounded-2xl border border-slate-200 dark:border-slate-805 shadow-md bg-slate-950" />
                        <Button
                          variant="secondary"
                          onClick={() => setIdImageBase64(null)}
                          className="absolute bottom-2 bg-slate-950/70 hover:bg-slate-950/90 text-white text-[9px] font-black py-1 px-3 h-auto rounded-xl backdrop-blur-sm transition-all"
                        >
                          Change ID
                        </Button>
                      </div>
                      <div className="flex flex-col items-center gap-2 relative">
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Captured Selfie</span>
                        <img src={selfieImageBase64} className="w-full aspect-video object-cover rounded-2xl border border-slate-200 dark:border-slate-805 shadow-md bg-slate-950" />
                        <Button
                          variant="secondary"
                          onClick={() => setSelfieImageBase64(null)}
                          className="absolute bottom-2 bg-slate-950/70 hover:bg-slate-950/90 text-white text-[9px] font-black py-1 px-3 h-auto rounded-xl backdrop-blur-sm transition-all"
                        >
                          Change Selfie
                        </Button>
                      </div>
                    </div>

                    {verificationError && (
                      <div className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-955/40 text-rose-700 dark:text-rose-450 text-xs font-semibold leading-relaxed w-full text-left">
                        {verificationError}
                      </div>
                    )}

                    <div className="flex gap-4 border-t border-slate-100 dark:border-slate-800 pt-4 w-full justify-center">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIdImageBase64(null);
                          setSelfieImageBase64(null);
                          setVerificationError(null);
                        }}
                        className="rounded-2xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold text-xs"
                      >
                        Reset All
                      </Button>
                      <Button
                        onClick={handleVerifyIdentity}
                        className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold rounded-2xl px-8 shadow-md shadow-indigo-500/25 flex items-center gap-2 text-xs"
                      >
                        Run AI Matching <Sparkles className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Start Confirmation Modal - Monitoring & Integrity Policy */}
      {showStartConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-2xl w-full p-8 shadow-2xl border border-red-500/20 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl max-h-[90vh] flex flex-col">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-500 to-rose-600 animate-pulse" />
            
            <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 mb-4 flex-shrink-0">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/35">
                <ShieldAlert className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">Test Monitoring & Integrity Policy</h2>
                <p className="text-xs text-red-500 dark:text-rose-400 font-extrabold uppercase tracking-wider mt-0.5 animate-pulse">Active AI Proctoring Enabled</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-5 pr-2 mb-6 scrollbar-thin scrollbar-thumb-indigo-50 dark:scrollbar-thumb-slate-805">
              <p className="text-slate-600 dark:text-slate-350 text-sm font-semibold leading-relaxed">
                This assessment is monitored using AI-powered face, voice, and focus monitoring. The following actions are strictly prohibited and will trigger security warnings:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {[
                  "More than one person detected in camera feed.",
                  "No face detected in camera feed for > 5 seconds.",
                  "Multiple voices or active conversations detected.",
                  "Switching browser tabs or leaving the page.",
                  "Minimizing the browser window.",
                  "Exiting fullscreen mode.",
                  "Opening other applications or windows.",
                  "Leaving the test screen for any reason.",
                  "Right-clicking or attempting to inspect elements.",
                  "Copying, cutting, or pasting text inside the test."
                ].map((rule, idx) => (
                  <div key={idx} className="flex items-start gap-3 bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-100 dark:border-slate-900">
                    <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-950/35 flex items-center justify-center text-[10px] font-black text-red-600 dark:text-rose-400 flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300 leading-snug">{rule}</p>
                  </div>
                ))}
              </div>

              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-800 dark:text-rose-350 p-5 rounded-2xl space-y-2.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-red-700 dark:text-rose-400 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" /> System Warning & Violation Handling:
                </h4>
                <ul className="text-xs font-semibold leading-relaxed space-y-1.5 list-disc list-inside pl-1">
                  <li>Each detected violation immediately generates a warning notification.</li>
                  <li>Live warnings counter display: <strong className="font-extrabold text-red-600 dark:text-red-400">Warning 1/3, Warning 2/3, Warning 3/3</strong>.</li>
                  <li>Upon triggering the **3rd warning**, your assessment will be **automatically submitted immediately** with all captured progress.</li>
                  <li>All violation events, timestamps, and proctoring metrics are recorded in your permanent assessment log for recruiter audit.</li>
                </ul>
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex-shrink-0 flex flex-wrap gap-4 justify-between items-center">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold max-w-[50%] leading-normal">
                By clicking "Start Test Now", you consent to fullscreen activation and active proctoring checks.
              </span>
              <div className="flex gap-3">
                <Button onClick={cancelStartConfirm} variant="outline" className="rounded-2xl border-indigo-200 dark:border-slate-850 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold text-xs">
                  Cancel & Go Back
                </Button>
                <Button onClick={startInterview} className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white gap-2 rounded-2xl px-6 py-5 font-bold shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/35 transition-all text-xs">
                  Start Test Now <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* End Test Confirmation Modal */}
      {showEndConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-lg w-full p-8 shadow-2xl border border-indigo-100 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-500 to-rose-600" />
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/30 mb-6">
              <ShieldAlert className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-4 text-center">End Assessment?</h2>
            <p className="text-slate-600 dark:text-slate-350 mb-6 text-center leading-relaxed text-sm">
              Are you sure you want to end the test early? This will submit your current progress and officially close your session. You will not be able to re-enter.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Button onClick={() => setShowEndConfirm(false)} variant="outline" className="rounded-2xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold">
                No, Continue Test
              </Button>
              <Button onClick={() => { setShowEndConfirm(false); setShowReviewModal(true); }} className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white gap-2 rounded-2xl px-6 font-bold shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/35 transition-all">
                Yes, End Assessment
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Reset Template Confirmation Modal */}
      {showResetConfirmModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-lg w-full p-8 shadow-2xl border border-indigo-100 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-500 to-rose-600" />
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/30 mb-6">
              <RotateCcw className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-4 text-center">Reset Code Editor?</h2>
            <p className="text-slate-600 dark:text-slate-350 mb-6 text-center leading-relaxed text-sm font-semibold">
              Are you sure you want to reset the editor to the default template? This will erase all your current code changes.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Button onClick={() => setShowResetConfirmModal(false)} variant="outline" className="rounded-2xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold">
                Cancel
              </Button>
              <Button onClick={() => { setShowResetConfirmModal(false); setAnswer(DEFAULT_TEMPLATES[selectedLanguage]); }} className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white gap-2 rounded-2xl px-6 font-bold shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/35 transition-all">
                Reset Template
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Submit Without Running Code Warning Modal */}
      {showSubmitWithoutRunConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-lg w-full p-8 shadow-2xl border border-indigo-100 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-500 to-orange-600" />
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30 mb-6">
              <ShieldAlert className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-4 text-center">Submit Without Running?</h2>
            <p className="text-slate-600 dark:text-slate-350 mb-6 text-center leading-relaxed text-sm font-semibold">
              If you submit the code without running it will be considered no answered.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Button 
                onClick={() => {
                  setShowSubmitWithoutRunConfirm(false);
                  setPendingNavigation(null);
                }} 
                variant="outline" 
                className="rounded-2xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold"
              >
                Go Back & Run Code
              </Button>
              <Button 
                onClick={() => {
                  setShowSubmitWithoutRunConfirm(false);
                  if (pendingNavigation) {
                    handleNavigateToSection(pendingNavigation.step, pendingNavigation.index, true);
                    setPendingNavigation(null);
                  } else {
                    handleNext(true);
                  }
                }} 
                className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white gap-2 rounded-2xl px-6 font-bold shadow-md shadow-amber-500/25 hover:shadow-lg hover:shadow-amber-500/35 transition-all"
              >
                Submit Anyway
              </Button>
            </div>
          </Card>
        </motion.div>
      )}
      {showSubmitSuccess && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-lg w-full p-8 shadow-2xl border border-indigo-100 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 to-green-500" />
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 mb-6">
              <CheckCircle className="w-7 h-7 text-white animate-bounce" />
            </div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-4 text-center">Assessment Submitted!</h2>
            <p className="text-slate-600 dark:text-slate-350 mb-8 text-center leading-relaxed text-sm">
              Your responses have been successfully recorded. We have registered your questions and will reply to them through email.
            </p>
            <div className="flex justify-center">
              <Button onClick={() => {
                setShowSubmitSuccess(false);
              }} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white gap-2 rounded-2xl px-8 py-6 font-bold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all text-base">
                Finish Assessment <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {showReviewModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 dark:bg-slate-950/80 backdrop-blur-md p-4"
        >
          <Card className="max-w-3xl w-full p-8 shadow-2xl border border-indigo-100 dark:border-slate-800 relative overflow-hidden bg-white dark:bg-slate-900 rounded-3xl flex flex-col max-h-[85vh]">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            
            <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-2 text-center">Review Your Responses</h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6 text-center text-xs leading-relaxed">
              Please review your answers below before submitting your assessment. You can go back to make changes if needed.
            </p>

            {/* Status Statistics */}
            {(() => {
              const totalTech = questions.length;
              let answeredTech = 0;
              let skippedTech = 0;
              questions.forEach((_, idx) => {
                const val = submittedAnswers[idx];
                if (val !== undefined && val.trim() !== "" && val !== "[Skipped]") {
                  answeredTech++;
                } else {
                  skippedTech++;
                }
              });

              const introAnswered = submittedAnswers[-1] !== undefined && submittedAnswers[-1].trim() !== "" && submittedAnswers[-1] !== "[Skipped]";
              const hrAnswered = submittedAnswers[-2] !== undefined && submittedAnswers[-2].trim() !== "" && submittedAnswers[-2] !== "[Skipped]";

              return (
                <div className="grid grid-cols-3 gap-4 mb-6 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-150 dark:border-slate-850 text-center">
                  <div>
                    <span className="block text-[10px] font-black text-slate-500 dark:text-slate-450 uppercase tracking-wider">Introduction</span>
                    <span className={`text-xs font-extrabold ${introAnswered ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {introAnswered ? 'Completed' : 'Skipped'}
                    </span>
                  </div>
                  <div className="border-x border-slate-200 dark:border-slate-800">
                    <span className="block text-[10px] font-black text-slate-500 dark:text-slate-450 uppercase tracking-wider">Technical Questions</span>
                    <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">
                      <span className="text-emerald-600 dark:text-emerald-400">{answeredTech}</span> / <span className="text-amber-600 dark:text-amber-400">{skippedTech} Skipped</span>
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-black text-slate-500 dark:text-slate-450 uppercase tracking-wider">HR Inquiries</span>
                    <span className={`text-xs font-extrabold ${hrAnswered ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {hrAnswered ? 'Completed' : 'Skipped'}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Scrollable list of answers */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-6 scrollbar-thin scrollbar-thumb-indigo-150 dark:scrollbar-thumb-slate-800">
              {/* Introduction */}
              <div className="p-4 rounded-2xl border border-indigo-50/50 dark:border-slate-850 bg-indigo-50/10 dark:bg-slate-900/50 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-indigo-650 dark:text-violet-400 uppercase tracking-wider">1. Candidate Introduction</span>
                  <Badge variant="outline" className={`border-0 text-[10px] font-bold ${
                    submittedAnswers[-1] && submittedAnswers[-1].trim() !== "" && submittedAnswers[-1] !== "[Skipped]"
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                  }`}>
                    {submittedAnswers[-1] && submittedAnswers[-1].trim() !== "" && submittedAnswers[-1] !== "[Skipped]" ? 'Answered' : 'Skipped'}
                  </Badge>
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-350 font-medium whitespace-pre-wrap leading-relaxed max-h-[80px] overflow-y-auto bg-slate-50/80 dark:bg-slate-950/80 p-2.5 rounded-xl border border-slate-100 dark:border-slate-850">
                  {submittedAnswers[-1] && submittedAnswers[-1].trim() !== "" ? submittedAnswers[-1] : "[No response provided]"}
                </div>
              </div>

              {/* Technical Questions */}
              {questions.map((q, idx) => {
                const ans = submittedAnswers[idx];
                const isAnswered = ans !== undefined && ans.trim() !== "" && ans !== "[Skipped]";
                const isCoding = q.startsWith("Coding Challenge:");

                return (
                  <div key={idx} className="p-4 rounded-2xl border border-indigo-50/50 dark:border-slate-850 bg-indigo-50/10 dark:bg-slate-900/50 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black text-indigo-650 dark:text-violet-400 uppercase tracking-wider">
                        {isCoding ? `Question ${idx + 1} (Coding)` : `Question ${idx + 1}`}
                      </span>
                      <Badge variant="outline" className={`border-0 text-[10px] font-bold ${
                        isAnswered
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                      }`}>
                        {isAnswered ? 'Answered' : 'Skipped'}
                      </Badge>
                    </div>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 leading-snug">{q}</p>
                    <div className={`text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-[100px] overflow-y-auto bg-slate-50/80 dark:bg-slate-950/80 p-2.5 rounded-xl border border-slate-100 dark:border-slate-850 ${
                      isCoding ? 'font-mono text-[11px] bg-slate-950 text-indigo-200' : 'font-medium'
                    }`}>
                      {ans && ans.trim() !== "" ? ans : "[No response provided]"}
                    </div>
                  </div>
                );
              })}

              {/* HR Questions */}
              <div className="p-4 rounded-2xl border border-indigo-50/50 dark:border-slate-850 bg-indigo-50/10 dark:bg-slate-900/50 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-indigo-650 dark:text-violet-400 uppercase tracking-wider">4. Questions for Us</span>
                  <Badge variant="outline" className={`border-0 text-[10px] font-bold ${
                    submittedAnswers[-2] && submittedAnswers[-2].trim() !== "" && submittedAnswers[-2] !== "[Skipped]"
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                  }`}>
                    {submittedAnswers[-2] && submittedAnswers[-2].trim() !== "" && submittedAnswers[-2] !== "[Skipped]" ? 'Answered' : 'Skipped'}
                  </Badge>
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-350 font-medium whitespace-pre-wrap leading-relaxed max-h-[80px] overflow-y-auto bg-slate-50/80 dark:bg-slate-950/80 p-2.5 rounded-xl border border-slate-100 dark:border-slate-850">
                  {submittedAnswers[-2] && submittedAnswers[-2].trim() !== "" ? submittedAnswers[-2] : "[No response provided]"}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-4 justify-between mt-auto pt-4 border-t border-slate-100 dark:border-slate-850">
              <Button 
                onClick={() => setShowReviewModal(false)} 
                variant="outline" 
                className="rounded-2xl border-indigo-200 dark:border-slate-800 text-indigo-700 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 px-6 font-bold text-sm"
              >
                Back to Assessment
              </Button>
              <Button 
                onClick={() => {
                  setShowReviewModal(false);
                  finalizeInterview();
                  setShowSubmitSuccess(true);
                }} 
                className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white gap-2 rounded-2xl px-6 font-bold shadow-md shadow-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/35 transition-all text-sm"
              >
                Submit Assessment
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      <main className="max-w-full mx-auto px-6 md:px-12 py-8">
        {isInitializing ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-40 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Sparkles className="w-7 h-7 text-white animate-pulse" />
            </div>
            <p className="text-slate-600 font-bold animate-pulse text-sm">Generating your personalized questions…</p>
          </motion.div>
        ) : !interviewEnded ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              
              {/* Left Panel: Questions Overview (lg:col-span-2) */}
              <div className="lg:col-span-2 flex flex-col space-y-4">
                <Card className="p-5 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl flex-1 flex flex-col overflow-hidden min-h-[500px]">
                  <div className="flex items-center justify-between border-b border-indigo-50 dark:border-slate-800 pb-3 mb-4">
                    <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Assessment Progress</h3>
                    <Badge className="bg-indigo-50 dark:bg-slate-800 text-indigo-700 dark:text-violet-400 font-bold border-0 text-[10px]">
                      {currentStep === 'setup' ? '0' : currentStep === 'intro' ? '5' : currentStep === 'candidate_question' ? '95' : Math.min(90, Math.round(((currentIndex + 1) / (questions.length || 1)) * 90))}%
                    </Badge>
                  </div>
                  
                  <div className="flex-grow space-y-4 pr-1">
                    {/* Introduction Step */}
                    {(() => {
                      const hasIntroAnswer = submittedAnswers[-1] !== undefined && submittedAnswers[-1].trim() !== "" && submittedAnswers[-1] !== "[Skipped]";
                      const isIntroPast = currentStep !== 'intro' && currentStep !== 'setup';
                      const isIntroSuccessful = isIntroPast && hasIntroAnswer;
                      const isIntroSkipped = isIntroPast && !hasIntroAnswer;

                      return (
                        <div 
                          onClick={() => handleNavigateToSection('intro')}
                          className={`flex items-center gap-3.5 p-3.5 rounded-2xl transition-all duration-200 cursor-pointer hover:bg-indigo-50/30 dark:hover:bg-slate-800/30 ${
                            currentStep === 'intro' 
                              ? 'bg-indigo-50/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700 shadow-sm' 
                              : 'border border-transparent'
                          }`}
                        >
                          {isIntroSuccessful ? (
                            <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0 border border-emerald-200 dark:border-emerald-800/50">
                              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                          ) : isIntroSkipped ? (
                            <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-800/50" title="Skipped">
                              <CheckCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            </div>
                          ) : (
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 border transition-all ${
                              currentStep === 'intro'
                                ? 'border-indigo-500 bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800'
                            }`}>
                              1
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className={`text-xs font-bold leading-none ${
                              currentStep === 'intro'
                                ? 'text-indigo-950 dark:text-indigo-200 font-black'
                                : isIntroSuccessful
                                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                  : isIntroSkipped
                                    ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                    : 'text-slate-600 dark:text-slate-300'
                            }`}>
                              Introduction
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-medium">Professional summary</span>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Technical Questions Step */}
                    {(() => {
                      const theoreticalQuestions = questions
                        .map((q, idx) => ({ q, idx }))
                        .filter(item => !item.q.startsWith("Coding Challenge:"));
                      
                      const isActive = currentStep === 'questions' && !questions[currentIndex]?.startsWith("Coding Challenge:");
                      const isCompleted = currentStep === 'candidate_question' || showSubmitSuccess || (currentStep === 'questions' && questions[currentIndex]?.startsWith("Coding Challenge:"));
                      
                      const hasAnySkipped = theoreticalQuestions.some(({ idx }) => {
                        const ans = submittedAnswers[idx];
                        return ans === undefined || ans.trim() === "" || ans === "[Skipped]";
                      });

                      const isTechSuccessful = isCompleted && !hasAnySkipped;
                      const isTechSkipped = isCompleted && hasAnySkipped;
                      const currentVerbalNumber = theoreticalQuestions.findIndex(item => item.idx === currentIndex) + 1;

                      return (
                        <div className="flex flex-col">
                          <div 
                            onClick={() => setIsTechExpanded(!isTechExpanded)}
                            className={`flex items-center gap-3.5 p-3.5 rounded-2xl transition-all duration-200 cursor-pointer hover:bg-indigo-50/30 dark:hover:bg-slate-800/30 ${
                              isActive 
                                ? 'bg-indigo-50/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700 shadow-sm' 
                                : 'border border-transparent'
                            }`}
                          >
                            {isTechSuccessful ? (
                              <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0 border border-emerald-200 dark:border-emerald-800/50">
                                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              </div>
                            ) : isTechSkipped ? (
                              <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-955/30 flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-800/50">
                                <CheckCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                              </div>
                            ) : (
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 border transition-all ${
                                isActive
                                  ? 'border-indigo-500 bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800'
                              }`}>
                                2
                              </div>
                            )}
                            <div className="flex-1 flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className={`text-xs font-bold leading-none ${
                                  isActive
                                    ? 'text-indigo-950 dark:text-indigo-200 font-black'
                                    : isTechSuccessful
                                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                      : isTechSkipped
                                        ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                        : 'text-slate-650 dark:text-slate-350'
                                }`}>
                                  Verbal Questions
                                </span>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
                                  {isActive 
                                    ? `Question ${currentVerbalNumber} of ${theoreticalQuestions.length}` 
                                    : `Interview verbal questions (${theoreticalQuestions.length} questions)`}
                                </span>
                              </div>
                              {isTechExpanded ? (
                                <ChevronUp className="w-4 h-4 text-slate-600 dark:text-slate-400 flex-shrink-0" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-600 dark:text-slate-400 flex-shrink-0" />
                              )}
                            </div>
                          </div>

                          {/* Sub-list of Questions */}
                          {isTechExpanded && theoreticalQuestions.length > 0 && (
                            <div className="pl-6 pr-1 py-2 space-y-1.5 border-l border-indigo-100/50 dark:border-slate-800 ml-3.5 mt-1 max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-indigo-100 dark:scrollbar-thumb-slate-800 transition-all duration-300">
                              {theoreticalQuestions.map(({ q, idx }, listIdx) => {
                                const isQActive = currentStep === 'questions' && idx === currentIndex;
                                const answerValue = submittedAnswers[idx];
                                const hasAttempted = answerValue !== undefined;
                                const hasAnswer = hasAttempted && answerValue.trim() !== "" && answerValue !== "[Skipped]";
                                const isSuccessful = hasAttempted && hasAnswer;
                                const isSkippedOrEmpty = hasAttempted && !hasAnswer;

                                return (
                                  <div 
                                    key={idx} 
                                    onClick={() => handleNavigateToSection('questions', idx)}
                                    className={`flex items-center gap-2.5 p-2 rounded-xl transition-all duration-150 cursor-pointer hover:bg-indigo-50/20 dark:hover:bg-slate-800/40 ${
                                      isQActive 
                                        ? 'bg-indigo-50/50 dark:bg-slate-800/50 border border-indigo-100/60 dark:border-slate-700 shadow-sm' 
                                        : 'border border-transparent'
                                    }`}
                                  >
                                    {isSuccessful ? (
                                      <div className="w-4.5 h-4.5 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0 border border-emerald-200 dark:border-emerald-800/50">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                                      </div>
                                    ) : isSkippedOrEmpty ? (
                                      <div className="w-4.5 h-4.5 rounded-full bg-amber-100 dark:bg-amber-955/30 flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-800/50" title="Skipped">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                                      </div>
                                    ) : (
                                      <div className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 border ${
                                        isQActive
                                          ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm shadow-indigo-500/20'
                                          : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800'
                                      }`}>
                                        {listIdx + 1}
                                      </div>
                                    )}
                                    <span className={`text-[11px] font-bold truncate max-w-[130px] ${
                                      isQActive
                                        ? 'text-indigo-950 dark:text-indigo-200 font-extrabold'
                                        : isSuccessful
                                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                          : isSkippedOrEmpty
                                            ? 'text-amber-650 dark:text-amber-400 font-semibold'
                                            : 'text-slate-500 dark:text-slate-450'
                                    }`} title={`Question ${listIdx + 1}: ${q}`}>
                                      Question {listIdx + 1}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Coding Challenges Step */}
                    {(() => {
                      const codingQuestions = questions
                        .map((q, idx) => ({ q, idx }))
                        .filter(item => item.q.startsWith("Coding Challenge:"));

                      if (codingQuestions.length === 0) return null;

                      const isActive = currentStep === 'questions' && questions[currentIndex]?.startsWith("Coding Challenge:");
                      const isCompleted = currentStep === 'candidate_question' || showSubmitSuccess;
                      
                      const hasAnySkipped = codingQuestions.some(({ idx }) => {
                        const ans = submittedAnswers[idx];
                        return ans === undefined || ans.trim() === "" || ans === "[Skipped]";
                      });

                      const isCodingSuccessful = isCompleted && !hasAnySkipped;
                      const isCodingSkipped = isCompleted && hasAnySkipped;
                      const currentCodingNumber = codingQuestions.findIndex(item => item.idx === currentIndex) + 1;

                      return (
                        <div className="flex flex-col mt-2">
                          <div 
                            onClick={() => setIsCodingExpanded(!isCodingExpanded)}
                            className={`flex items-center gap-3.5 p-3.5 rounded-2xl transition-all duration-200 cursor-pointer hover:bg-indigo-50/30 dark:hover:bg-slate-800/30 ${
                              isActive 
                                ? 'bg-indigo-50/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700 shadow-sm' 
                                : 'border border-transparent'
                            }`}
                          >
                            {isCodingSuccessful ? (
                              <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0 border border-emerald-200 dark:border-emerald-800/50">
                                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              </div>
                            ) : isCodingSkipped ? (
                              <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-800/50">
                                <CheckCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                              </div>
                            ) : (
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 border transition-all ${
                                isActive
                                  ? 'border-indigo-500 bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800'
                              }`}>
                                3
                              </div>
                            )}
                            <div className="flex-1 flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className={`text-xs font-bold leading-none ${
                                  isActive
                                    ? 'text-indigo-950 dark:text-indigo-200 font-black'
                                    : isCodingSuccessful
                                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                      : isCodingSkipped
                                        ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                        : 'text-slate-650 dark:text-slate-350'
                                }`}>
                                  Coding Challenges
                                </span>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
                                  {isActive 
                                    ? `Question ${currentCodingNumber} of ${codingQuestions.length}` 
                                    : `Hands-on (${codingQuestions.length} challenges)`}
                                </span>
                              </div>
                              {isCodingExpanded ? (
                                <ChevronUp className="w-4 h-4 text-slate-600 dark:text-slate-400 flex-shrink-0" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-600 dark:text-slate-400 flex-shrink-0" />
                              )}
                            </div>
                          </div>
 
                          {/* List of coding questions directly visible when coding challenges step or active */}
                          {isCodingExpanded && (
                            <div className="pl-6 pr-1 py-1 space-y-1.5 border-l border-indigo-100/50 dark:border-slate-800 ml-3.5 mb-2 transition-all duration-300">
                              {codingQuestions.map(({ q, idx }, listIdx) => {
                                const isQActive = currentStep === 'questions' && idx === currentIndex;
                                const answerValue = submittedAnswers[idx];
                                const hasAttempted = answerValue !== undefined;
                                const hasAnswer = hasAttempted && answerValue.trim() !== "" && answerValue !== "[Skipped]";
                                const isSuccessful = hasAttempted && hasAnswer;
                                const isSkippedOrEmpty = hasAttempted && !hasAnswer;

                                return (
                                  <div 
                                    key={idx} 
                                    onClick={() => handleNavigateToSection('questions', idx)}
                                    className={`flex items-center gap-2.5 p-2 rounded-xl transition-all duration-150 cursor-pointer hover:bg-indigo-50/20 dark:hover:bg-slate-800/40 ${
                                      isQActive 
                                        ? 'bg-indigo-50/50 dark:bg-slate-800/50 border border-indigo-100/60 dark:border-slate-700 shadow-sm' 
                                        : 'border border-transparent'
                                    }`}
                                  >
                                    {isSuccessful ? (
                                      <div className="w-4.5 h-4.5 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0 border border-emerald-200 dark:border-emerald-800/50">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                                      </div>
                                    ) : isSkippedOrEmpty ? (
                                      <div className="w-4.5 h-4.5 rounded-full bg-amber-100 dark:bg-amber-955/30 flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-800/50" title="Skipped">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                                      </div>
                                    ) : (
                                      <div className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 border ${
                                        isQActive
                                          ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm shadow-indigo-500/20'
                                          : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800'
                                      }`}>
                                        {listIdx + 1}
                                      </div>
                                    )}
                                    <span className={`text-[11px] font-bold truncate max-w-[130px] ${
                                      isQActive
                                        ? 'text-indigo-950 dark:text-indigo-200 font-extrabold'
                                        : isSuccessful
                                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                          : isSkippedOrEmpty
                                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                            : 'text-slate-500 dark:text-slate-450'
                                    }`} title={`Coding Challenge ${listIdx + 1}`}>
                                      Coding {listIdx + 1}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* Questions for Us Step */}
                    {(() => {
                      const isActive = currentStep === 'candidate_question';
                      const isCompleted = showSubmitSuccess;

                      const hasHrAnswer = submittedAnswers[-2] !== undefined && submittedAnswers[-2].trim() !== "" && submittedAnswers[-2] !== "[Skipped]";
                      const isHrSuccessful = isCompleted && hasHrAnswer;
                      const isHrSkipped = isCompleted && !hasHrAnswer;

                      return (
                        <div 
                          onClick={() => handleNavigateToSection('candidate_question')}
                          className={`flex items-center gap-3.5 p-3.5 rounded-2xl transition-all duration-200 cursor-pointer hover:bg-indigo-50/30 dark:hover:bg-slate-800/30 ${
                            isActive 
                              ? 'bg-indigo-50/80 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700 shadow-sm' 
                              : 'border border-transparent'
                          }`}
                        >
                          {isHrSuccessful ? (
                            <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0 border border-emerald-200 dark:border-emerald-800/50">
                              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                          ) : isHrSkipped ? (
                            <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0 border border-amber-200 dark:border-amber-800/50">
                              <CheckCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            </div>
                          ) : (
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 border transition-all ${
                              isActive
                                ? 'border-indigo-500 bg-indigo-500 text-white shadow-md shadow-indigo-500/20 animate-pulse'
                                : 'border-slate-300 dark:border-slate-755 text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800'
                            }`}>
                              4
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className={`text-xs font-bold leading-none ${
                              isActive
                                ? 'text-indigo-950 dark:text-indigo-200 font-black'
                                : isHrSuccessful
                                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                  : isHrSkipped
                                    ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                    : 'text-slate-650 dark:text-slate-350'
                            }`}>
                              Questions for Us
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-medium">Inquiries for HR Team</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </Card>
              </div>
              {!isCodingQuestion ? (
                <>
                  {/* VIDEO CALL INTERFACE (6 Columns) */}
                  <div className="lg:col-span-6 flex flex-col space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
                      
                      {/* AI Interviewer Tile */}
                      <Card className={`aspect-video rounded-[32px] overflow-hidden relative border transition-all duration-300 shadow-lg flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 ${
                        isAiSpeaking 
                          ? 'ring-4 ring-indigo-500 ring-offset-4 ring-offset-slate-900 border-transparent shadow-indigo-500/35' 
                          : 'border-slate-800'
                      }`}>
                        {/* Animated Soundwaves Ripples */}
                        <div className="relative flex items-center justify-center">
                          {isAiSpeaking && (
                            <>
                              <div className="absolute w-32 h-32 rounded-full bg-indigo-500/20 border border-indigo-500/30 animate-ripple" style={{ animationDelay: '0s' }}></div>
                              <div className="absolute w-32 h-32 rounded-full bg-indigo-500/20 border border-indigo-500/30 animate-ripple" style={{ animationDelay: '0.6s' }}></div>
                              <div className="absolute w-32 h-32 rounded-full bg-indigo-500/20 border border-indigo-500/30 animate-ripple" style={{ animationDelay: '1.2s' }}></div>
                            </>
                          )}
                          
                          <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 z-10 border border-indigo-400">
                            <Bot className="w-12 h-12 text-white" />
                          </div>
                        </div>

                        {/* AI Label */}
                        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-slate-900/90 backdrop-blur-sm px-3.5 py-1.5 rounded-2xl border border-slate-800">
                          <div className={`w-2.5 h-2.5 rounded-full ${isAiSpeaking ? 'bg-indigo-500 animate-pulse' : 'bg-slate-500'}`} />
                          <span className="text-xs font-black text-slate-200 uppercase tracking-wider">Interviewer</span>
                        </div>

                        {/* Speaking / Listening Equalizer */}
                        {isAiSpeaking && (
                          <div className="absolute bottom-4 right-4 bg-slate-900/90 backdrop-blur-sm px-3.5 py-1.5 rounded-2xl border border-indigo-500/30 flex items-center gap-2">
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Speaking</span>
                            <div className="flex items-end gap-0.5 h-4 justify-center">
                              <div className="w-0.5 bg-indigo-400 rounded-full animate-equalizer h-1" style={{ animationDelay: '0.1s' }} />
                              <div className="w-0.5 bg-indigo-400 rounded-full animate-equalizer h-1" style={{ animationDelay: '0.3s' }} />
                              <div className="w-0.5 bg-indigo-400 rounded-full animate-equalizer h-1" style={{ animationDelay: '0.5s' }} />
                              <div className="w-0.5 bg-indigo-400 rounded-full animate-equalizer h-1" style={{ animationDelay: '0.2s' }} />
                            </div>
                          </div>
                        )}
                      </Card>

                      {/* Candidate Tile */}
                      <Card className={`aspect-video rounded-[32px] overflow-hidden relative border transition-all duration-300 shadow-lg bg-slate-950 ${
                        isUserSpeaking 
                          ? 'ring-4 ring-emerald-500 ring-offset-4 ring-offset-slate-900 border-transparent shadow-emerald-500/35' 
                          : 'border-slate-800'
                      }`}>
                        {/* Camera Feed */}
                        <video
                          ref={videoCallbackRef}
                          autoPlay
                          muted
                          playsInline
                          onClick={cycleProctorState}
                          className="w-full h-full object-cover rounded-[30px] cursor-pointer"
                          title="Click to cycle AI proctor states (Dev Mode)"
                        />


                        {/* Candidate Label */}
                        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-slate-900/90 backdrop-blur-sm px-3.5 py-1.5 rounded-2xl border border-slate-800 z-20">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          <span className="text-xs font-black text-slate-200 uppercase tracking-wider">You</span>
                        </div>

                        {/* Audio visualizer bar in candidate corner */}
                        <div className="absolute bottom-4 right-4 bg-slate-900/90 backdrop-blur-sm px-3.5 py-1.5 rounded-2xl border border-slate-800 flex items-center gap-2.5 z-20">
                          {isMicListening ? (
                            <>
                              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">
                                {isUserSpeaking ? "Speaking" : "Listening"}
                              </span>
                              <div className="flex items-end gap-0.5 h-4 w-6 justify-center">
                                <div 
                                  className="w-0.5 bg-emerald-400 rounded-full transition-all duration-75" 
                                  style={{ height: isUserSpeaking ? `${Math.max(4, Math.min(16, userVolume / 4))}px` : '3px' }} 
                                />
                                <div 
                                  className="w-0.5 bg-emerald-400 rounded-full transition-all duration-75" 
                                  style={{ height: isUserSpeaking ? `${Math.max(4, Math.min(16, userVolume / 3))}px` : '3px', transitionDelay: '0.02s' }} 
                                />
                                <div 
                                  className="w-0.5 bg-emerald-400 rounded-full transition-all duration-75" 
                                  style={{ height: isUserSpeaking ? `${Math.max(4, Math.min(16, userVolume / 5))}px` : '3px', transitionDelay: '0.04s' }} 
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Muted</span>
                              <MicOff className="w-3.5 h-3.5 text-rose-400" />
                            </>
                          )}
                        </div>

                        {/* REC Badge */}
                        {isRecording && (
                          <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-red-500/90 backdrop-blur-sm rounded-full px-3 py-1 z-20 shadow-md">
                            <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse"></div>
                            <span className="text-[9px] font-black text-white tracking-widest uppercase">REC</span>
                          </div>
                        )}
                      </Card>
                    </div>

                    <div className="bg-red-50/70 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-[24px] p-5 flex items-start gap-4 shadow-sm animate-pulse">
                      <ShieldAlert className="w-6 h-6 mt-0.5 text-red-500 dark:text-red-400 flex-shrink-0" />
                      <div>
                        <h4 className="text-sm font-bold text-red-955 mb-0.5">Recording Active</h4>
                        <p className="text-xs text-red-700/95 dark:text-red-400 leading-relaxed font-semibold">
                          Your response is processed in real time. Speak naturally. Once the interviewer finishes speaking, the microphone activates automatically. You can read, verify, and edit your answer transcription on the side panel before proceeding.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* SIDEBAR PANEL (4 Columns) */}
                  <div className="lg:col-span-4 flex flex-col space-y-6">
                    
                    {/* Question Info Card */}
                    <Card className="p-6 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
                      
                      <div className="flex justify-between items-center mb-4">
                        <Badge variant="outline" className="text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[9px] font-black border-indigo-200 dark:border-slate-800 bg-indigo-50 dark:bg-slate-950 px-2.5 py-0.5">
                          {currentStep === 'intro' 
                            ? 'Candidate Introduction' 
                            : currentStep === 'candidate_question' 
                              ? 'Questions for HR' 
                              : `Question ${currentIndex + 1} of ${questions.length}`}
                        </Badge>

                        {/* Repeat Voice Button */}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => {
                            if (currentStep === 'intro') {
                              speakQuestion("Welcome to the assessment. Please introduce yourself and summarize your professional background.");
                            } else if (currentStep === 'candidate_question') {
                              speakQuestion("Do you have any questions for the BizX HR Team?");
                            } else {
                              speakQuestion(questions[currentIndex]);
                            }
                          }}
                          className="h-8 px-2 text-indigo-600 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-700 dark:hover:text-violet-350 rounded-lg gap-1 text-[11px] font-bold"
                          disabled={isAiSpeaking || showStartConfirm}
                        >
                          <Volume2 className="w-3.5 h-3.5" /> Repeat Question
                        </Button>
                      </div>

                      <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 leading-snug">
                        {showStartConfirm 
                          ? "Assessment starting..." 
                          : currentStep === 'intro'
                            ? "Please introduce yourself, describing your professional background, key technical strengths, and relevant experience."
                            : currentStep === 'candidate_question'
                              ? "Do you have any questions for the BizX HR Team?"
                              : (questions[currentIndex] || "Generating...")}
                      </h3>
                      {currentStep === 'candidate_question' && (
                        <div className="text-xs font-semibold text-indigo-600 dark:text-violet-400 mt-3 bg-indigo-50/50 dark:bg-slate-800/50 p-3 rounded-xl border border-indigo-100/50 dark:border-slate-800 leading-relaxed">
                          Note: Whatever text is entered or transcribed in the live transcript area below will be emailed directly to the BizX HR Team.
                        </div>
                      )}
                    </Card>

                    {/* Transcribing panel */}
                    <Card className="p-6 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl flex-1 flex flex-col space-y-4 min-h-[300px]">
                      <div className="flex justify-between items-center">
                        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Live Transcript</h3>
                        
                        <Badge className={`border-0 font-bold uppercase tracking-wider text-[9px] px-2.5 py-0.5 ${
                          isMicListening 
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 animate-pulse' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-450'
                        }`}>
                          {isMicListening ? 'Listening' : 'Muted'}
                        </Badge>
                      </div>

                      <div className="relative flex-1 flex flex-col">
                        <textarea
                          id="answer"
                          className="w-full flex-1 min-h-[160px] p-4 text-slate-800 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-2xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all resize-none text-sm font-medium leading-relaxed"
                          placeholder={showStartConfirm ? "Permissions granted. Please click 'Start Test' to begin..." : (isMicListening ? "Start speaking now. Your voice response will be transcribed here..." : "Microphone is muted. Click 'Unmute Mic' to speak, or type your answer here...")}
                          value={answer}
                          onChange={e => setAnswer(e.target.value)}
                          disabled={showStartConfirm}
                        ></textarea>
                        
                        {!SpeechRecognition && (
                          <div className="mt-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-450 text-[10px] p-3 rounded-xl font-bold">
                            Speech Recognition is not supported on this browser. Please type your answers manually.
                          </div>
                        )}

                        {recognitionError && (
                          <div className="mt-2 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-rose-800 dark:text-rose-455 text-[11px] p-3 rounded-xl font-bold leading-relaxed">
                            {getErrorMessage(recognitionError)}
                          </div>
                        )}
                      </div>

                      {/* Mic toggle and Restart */}
                      <div className="flex items-center justify-between gap-3 pt-2">
                        <Button
                          variant="outline"
                          onClick={toggleMic}
                          className={`rounded-2xl border flex-1 h-10 font-bold gap-2 text-xs transition-all ${
                            isMicListening 
                              ? 'border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30' 
                              : 'border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                          }`}
                          disabled={isAiSpeaking || showStartConfirm}
                        >
                          {isMicListening ? (
                            <>
                              <MicOff className="w-3.5 h-3.5" /> Mute Mic
                            </>
                          ) : (
                            <>
                              <Mic className="w-3.5 h-3.5" /> Unmute Mic
                            </>
                          )}
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() => setAnswer('')}
                          className="rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-850 h-10 px-3 font-bold gap-1 text-xs"
                          disabled={!answer || showStartConfirm}
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Clear
                        </Button>
                      </div>
                    </Card>

                    {/* Sidebar Navigation */}
                    <div className="space-y-4 pt-2">
                      <Progress value={progressValue} className="h-2 bg-indigo-100/50 dark:bg-slate-800/50 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-violet-500" />
                      
                      <div className="flex gap-3">
                        {currentStep === 'questions' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1 h-12 rounded-2xl font-bold border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-700 transition-all text-sm"
                            disabled={isSubmitting || showStartConfirm}
                            onClick={handleSkip}
                          >
                            Skip Question
                          </Button>
                        )}
                        <Button
                          type="button"
                          className={`h-12 gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-2xl font-bold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all text-sm ${
                            currentStep === 'questions' ? 'flex-[2]' : 'w-full'
                          }`}
                          disabled={isSubmitting || showStartConfirm || (currentStep === 'questions' && questions.length === 0)}
                          onClick={() => handleNext()}
                        >
                          {isSubmitting ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Saving Response…</>
                          ) : (
                            <>
                              {(() => {
                                if (currentStep === 'intro') return 'Proceed to Questions';
                                if (currentStep === 'candidate_question') return 'Submit Assessment';
                                
                                const isCoding = questions[currentIndex]?.startsWith("Coding Challenge:");
                                const nextIsCoding = questions[currentIndex + 1]?.startsWith("Coding Challenge:");
                                const isLastQuestion = currentIndex >= questions.length - 1;

                                if (isLastQuestion) return 'Proceed to Questions for Us';
                                if (!isCoding && nextIsCoding) return 'Proceed to Coding Challenges';
                                if (isCoding) return 'Submit Code & Next';
                                return 'Next Question';
                              })()}
                              <ArrowRight className="w-4 h-4" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                  </div>
                </>
              ) : (
                <>
                  {/* IDE Left Column: Question Description & PIP webcam */}
                  <div className="lg:col-span-5 flex flex-col space-y-6">
                    {/* Problem Statement Card */}
                    <Card className="p-6 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl relative flex flex-col flex-1 overflow-hidden min-h-[500px]">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
                      
                      <div className="flex justify-between items-center mb-4 pb-3 border-b border-indigo-50 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          <Code2 className="w-5 h-5 text-indigo-600 dark:text-violet-400" />
                          <Badge variant="outline" className="text-indigo-600 dark:text-violet-400 uppercase tracking-wider text-[9px] font-black border-indigo-200 dark:border-slate-800 bg-indigo-50 dark:bg-slate-950 px-2.5 py-0.5">
                            Coding Challenge {questions.filter(q => q.startsWith("Coding Challenge:")).findIndex(q => q === questions[currentIndex]) + 1}
                          </Badge>
                        </div>

                        {/* Repeat Voice Button */}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => {
                            speakQuestion(questions[currentIndex]);
                          }}
                          className="h-8 px-2.5 text-indigo-600 dark:text-violet-400 hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-700 dark:hover:text-violet-350 rounded-lg gap-1 text-[11px] font-bold"
                          disabled={isAiSpeaking || showStartConfirm}
                        >
                          <Volume2 className="w-3.5 h-3.5" /> Repeat Question
                        </Button>
                      </div>

                      {/* Scrollable Question Content */}
                      <div className="flex-1 overflow-y-auto pr-2 mb-4 scrollbar-thin scrollbar-thumb-indigo-50 dark:scrollbar-thumb-slate-805">
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap">
                          {questions[currentIndex] || "Generating coding challenge..."}
                        </h3>
                      </div>

                      {/* PIP Webcam Card */}
                      <div className="mt-auto pt-4 border-t border-indigo-50 dark:border-slate-805 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4">
                        <div className="flex flex-col max-w-[50%]">
                          <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Webcam Recording</span>
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-350 mt-1 leading-snug">
                            Position your camera clearly. Your audio is paused, and screen feed is monitored.
                          </span>
                        </div>
                        
                        <div className="relative aspect-video w-36 md:w-44 rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-slate-800 shadow-md bg-slate-950 flex-shrink-0">
                          <video
                            ref={videoCallbackRef}
                            autoPlay
                            muted
                            playsInline
                            onClick={cycleProctorState}
                            className="w-full h-full object-cover cursor-pointer"
                            title="Click to cycle AI proctor states (Dev Mode)"
                          />
                          


                          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-slate-900/90 backdrop-blur-sm px-1.5 py-0.5 rounded-md border border-slate-800">
                            <div className="w-1 h-1 rounded-full bg-emerald-500" />
                            <span className="text-[8px] font-black text-slate-200 uppercase tracking-wider">You</span>
                          </div>
                          {isRecording && (
                            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-red-500/90 backdrop-blur-sm rounded-full px-1.5 py-0.5 z-10 shadow-sm">
                              <div className="w-1 h-1 rounded-full bg-white animate-pulse"></div>
                              <span className="text-[7px] font-black text-white tracking-wider uppercase">REC</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </div>

                  {/* IDE Right Column: Code Editor & Navigation */}
                  <div className="lg:col-span-5 flex flex-col space-y-6">
                    <Card className="p-6 border-indigo-100 dark:border-slate-800 shadow-md bg-white dark:bg-slate-900 rounded-3xl flex-1 flex flex-col overflow-hidden min-h-[500px]">
                      {/* Editor Header */}
                      <div className="flex items-center justify-between mb-4 pb-3 border-b border-indigo-50 dark:border-slate-850">
                        {/* Language Selector */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Language:</span>
                          <select
                            value={selectedLanguage}
                            onChange={(e) => setSelectedLanguage(e.target.value)}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer shadow-sm animate-none"
                          >
                            <option value="javascript">JavaScript</option>
                            <option value="typescript">TypeScript</option>
                            <option value="python">Python</option>
                            <option value="cpp">C++</option>
                            <option value="java">Java</option>
                          </select>
                        </div>

                        <div className="flex gap-2">
                          {/* Run Code */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRunCode}
                            disabled={isRunningCode || isSubmitting}
                            className="h-8 px-2.5 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl font-bold gap-1 text-[11px]"
                          >
                            {isRunningCode ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Code2 className="w-3.5 h-3.5" />
                            )}
                            {isRunningCode ? "Running..." : "Run Code"}
                          </Button>

                          {/* Reset Code */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowResetConfirmModal(true)}
                            className="h-8 px-2.5 text-slate-500 hover:text-indigo-600 dark:hover:text-violet-400 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-xl font-bold gap-1 text-[11px]"
                          >
                            <RotateCcw className="w-3 h-3" /> Reset Template
                          </Button>
                        </div>
                      </div>



                      {/* Editor Workspace Container */}
                      <div className="relative flex-1 flex border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-950 text-slate-100 font-mono text-[13px] leading-relaxed min-h-[280px]">
                        {/* Line Numbers Gutter */}
                        <div
                          ref={lineNumbersRef}
                          className="select-none py-4 text-right pr-3 pl-4 text-slate-600 dark:text-slate-500 bg-slate-900/40 border-r border-slate-800/80 overflow-hidden font-mono text-[13px]"
                          style={{ minWidth: '3.5rem', lineHeight: '1.5rem' }}
                        >
                          {lineNumbers.map((num) => (
                            <div key={num}>{num}</div>
                          ))}
                        </div>

                        {/* Code Textarea */}
                        <textarea
                          ref={textareaRef}
                          value={answer}
                          onChange={(e) => setAnswer(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onScroll={handleScroll}
                          className="flex-1 w-full p-4 bg-transparent text-slate-100 placeholder-slate-605 outline-none resize-none overflow-y-auto whitespace-pre font-mono text-[13px] scrollbar-thin scrollbar-thumb-slate-800"
                          style={{ lineHeight: '1.5rem', tabSize: 2 }}
                          placeholder="// Write your code solution here..."
                          spellCheck={false}
                        />
                      </div>

                      {/* Terminal Console */}
                      {(isRunningCode || terminalOutput) && (
                        <div className="mt-4 border border-slate-800 rounded-2xl bg-[#090d16] p-4 font-mono text-xs flex flex-col space-y-3 max-h-[260px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 text-slate-100">
                          <div className="flex items-center justify-between border-b border-slate-850 pb-2 mb-1">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider ml-1">Terminal</span>
                            </div>
                            {terminalOutput && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-500">Score:</span>
                                <Badge className={`${
                                  terminalOutput.score && terminalOutput.score >= 8 
                                    ? 'bg-emerald-950/40 text-emerald-450 border-emerald-800' 
                                    : terminalOutput.score && terminalOutput.score >= 5 
                                      ? 'bg-amber-950/40 text-amber-450 border-amber-800' 
                                      : 'bg-red-950/40 text-red-450 border-red-800'
                                } border font-bold text-[10px]`}>
                                  {terminalOutput.score !== null ? `${terminalOutput.score}/10` : '0/10'}
                                </Badge>
                              </div>
                            )}
                          </div>

                          {isRunningCode && (
                            <div className="flex items-center gap-2.5 text-slate-400 py-4 justify-center">
                              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                              <span className="text-xs">Executing tests, simulating runtime...</span>
                            </div>
                          )}

                          {terminalOutput && !isRunningCode && (
                            <div className="space-y-3">
                              {/* Compilation / Runtime Errors */}
                              {!terminalOutput.compiles ? (
                                <div className="space-y-2">
                                  <div className="text-red-550 font-bold flex items-center gap-1.5">
                                    <ShieldAlert className="w-4 h-4" /> COMPILATION ERROR
                                  </div>
                                  <pre className="bg-red-955/35 text-red-300 p-3 rounded-xl border border-red-900/50 whitespace-pre-wrap text-[11px] leading-relaxed">
                                    {terminalOutput.error || "Execution failed with compiler error."}
                                  </pre>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {/* Test cases list */}
                                  {terminalOutput.testCases.map((tc, index) => (
                                    <div key={index} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
                                      <div className="flex items-center justify-between border-b border-slate-800/40 pb-1.5">
                                        <span className="text-[11px] font-bold text-slate-200">{tc.name || `Test Case ${index + 1}`}</span>
                                        <Badge className={`${
                                          tc.passed 
                                            ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900/50' 
                                            : 'bg-rose-950/30 text-rose-455 border-rose-900/50'
                                        } border text-[9px] font-extrabold px-1.5 py-0`}>
                                          {tc.passed ? 'PASSED' : 'FAILED'}
                                        </Badge>
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] text-slate-400 font-medium">
                                        <div>
                                          <span className="block text-slate-500 text-[9px] uppercase tracking-wider">Input:</span>
                                          <code className="text-slate-350 font-mono">{tc.input}</code>
                                        </div>
                                        <div>
                                          <span className="block text-slate-500 text-[9px] uppercase tracking-wider">Expected:</span>
                                          <code className="text-emerald-400 font-mono">{tc.expected}</code>
                                        </div>
                                        <div>
                                          <span className="block text-slate-500 text-[9px] uppercase tracking-wider">Actual:</span>
                                          <code className={tc.passed ? 'text-emerald-400 font-mono' : 'text-rose-455 font-mono'}>{tc.actual}</code>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Sidebar Navigation */}
                      <div className="space-y-4 pt-4 mt-auto border-t border-indigo-50 dark:border-slate-850">
                        <Progress value={progressValue} className="h-2 bg-indigo-100/50 dark:bg-slate-800/50 [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-violet-500" />
                        
                        <div className="flex gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1 h-12 rounded-2xl font-bold border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-700 transition-all text-sm"
                            disabled={isSubmitting || showStartConfirm}
                            onClick={handleSkip}
                          >
                            Skip Question
                          </Button>
                          <Button
                            type="button"
                            className="h-12 gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-2xl font-bold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all text-sm flex-[2]"
                            disabled={isSubmitting || showStartConfirm || !answer || answer.trim() === ""}
                            onClick={() => handleNext()}
                          >
                            {isSubmitting ? (
                              <><Loader2 className="w-4 h-4 animate-spin" /> Saving Response…</>
                            ) : (
                              <>
                                {currentIndex >= questions.length - 1 ? 'Proceed to Questions for Us' : 'Submit Code & Next'}
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
                </>
              )}
            </div>

            <p className="text-center text-red-500 text-sm font-bold">
              Responses are saved automatically when you proceed. Do not refresh this page.
            </p>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex justify-center items-center py-20">
            <Card className="p-10 md:p-12 text-center max-w-lg border-0 shadow-xl bg-white dark:bg-slate-900 rounded-3xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 to-green-500" />
              <div className="w-20 h-20 bg-gradient-to-br from-emerald-100 dark:bg-emerald-950/20 to-green-100 dark:to-green-950/20 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/15">
                <CheckCircle className="w-10 h-10 text-emerald-500 dark:text-emerald-400" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-4">Interview Complete</h2>
              {isUploadingVideo ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <p className="text-slate-600 dark:text-slate-400 text-sm font-semibold">Securing and saving your video recording. Please do not close this window...</p>
                </div>
              ) : (
                <>
                  {warningCount >= 3 ? (
                    <>
                      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-800 dark:text-rose-350 p-5 rounded-2xl mb-6 flex items-start gap-3 text-left">
                        <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500 animate-pulse" />
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wider text-red-700 dark:text-rose-450">Assessment Auto-Submitted</h4>
                          <p className="text-xs font-semibold leading-relaxed mt-1">
                            Your test session was automatically submitted because you triggered the maximum limit of 3 proctoring policy warnings.
                          </p>
                        </div>
                      </div>
                      <p className="text-slate-600 dark:text-slate-350 leading-relaxed mb-8 text-sm">{COMPLETION_TEXT}</p>
                      <Link href="/">
                        <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white w-full rounded-2xl h-12 font-bold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all">
                          Return to Dashboard
                        </Button>
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-slate-600 dark:text-slate-350 leading-relaxed mb-8 text-sm">{COMPLETION_TEXT}</p>
                      <Link href="/">
                        <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white w-full rounded-2xl h-12 font-bold shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 transition-all">
                          Return to Dashboard
                        </Button>
                      </Link>
                    </>
                  )}
                </>
              )}
            </Card>
          </motion.div>
        )}
      </main>

      {/* Fullscreen Recovery Enforcer Lock Screen */}
      {showFullscreenRequired && currentStep !== 'setup' && !interviewEnded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/95 dark:bg-slate-950/95 backdrop-blur-lg p-6 animate-none"
        >
          <Card className="max-w-md w-full p-8 shadow-2xl border border-red-500/30 relative overflow-hidden bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-3xl text-center">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-500 to-rose-600 animate-pulse" />
            <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/30 mb-6">
              <ShieldAlert className="w-8 h-8 text-white animate-pulse" />
            </div>
            <h2 className="text-2xl font-black mb-3">Fullscreen Mode Required</h2>
            <p className="text-slate-650 dark:text-slate-350 text-sm mb-8 leading-relaxed font-semibold">
              This assessment requires continuous fullscreen monitoring. You have been locked out of the questions. Re-enter fullscreen mode immediately to restore access.
            </p>
            <Button
              onClick={async () => {
                const docEl = document.documentElement;
                try {
                  if (docEl.requestFullscreen) {
                    await docEl.requestFullscreen();
                  } else if ((docEl as any).webkitRequestFullscreen) {
                    await (docEl as any).webkitRequestFullscreen();
                  }
                  setShowFullscreenRequired(false);
                  setIsFullscreenActive(true);
                } catch (err) {
                  console.error("Failed to re-enter fullscreen:", err);
                  setGeneralError("Fullscreen activation failed. Please check browser permissions.");
                }
              }}
              className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-extrabold px-8 py-6 rounded-2xl shadow-lg transition-all text-base w-full"
            >
              Enter Fullscreen Mode
            </Button>
          </Card>
        </motion.div>
      )}


    </div>
  );
}
