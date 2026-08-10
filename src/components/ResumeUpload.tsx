"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2, Shield, Sparkles } from "lucide-react";
import { cn, formatFileSize, isValidResumeFile } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ResumeUploadProps {
  onUpload: (file: File) => Promise<void>;
  sessionCode: string;
  onSessionCodeChange: (code: string) => void;
}

export function ResumeUpload({ onUpload, sessionCode, onSessionCodeChange }: ResumeUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "validating" | "processing">("idle");
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selected = acceptedFiles[0];
    if (!selected) return;

    if (!isValidResumeFile(selected.name)) {
      setError("Please upload a PDF, DOC, or DOCX file");
      return;
    }

    if (selected.size > 10 * 1024 * 1024) {
      setError("File size must be under 10MB");
      return;
    }

    setFile(selected);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    multiple: false,
  });

  const handleUpload = async () => {
    if (!file) return;
    setStatus("uploading");
    setUploadProgress(0);

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 10, 90));
    }, 200);

    try {
      await onUpload(file);
      clearInterval(progressInterval);
      setUploadProgress(100);
      setStatus("processing");
    } catch (err: any) {
      clearInterval(progressInterval);
      setError(err.message || "Upload failed");
      setStatus("idle");
    }
  };

  const removeFile = () => {
    setFile(null);
    setUploadProgress(0);
    setStatus("idle");
    setError(null);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-slate-800 mb-2">Session Code</label>
          <input
            value={sessionCode}
            onChange={(event) => onSessionCodeChange(event.target.value)}
            className="w-full rounded-xl border-2 border-indigo-200 bg-white px-4 py-3.5 text-slate-900 font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition"
            placeholder="Enter your one-time session code"
          />
        </div>
        <p className="text-sm text-slate-500 leading-relaxed pl-1">Enter the one-time session code provided by your recruiter. Each code can only be used once.</p>
      </div>

      {/* Upload Area */}
      <div
        {...getRootProps()}
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 hover:shadow-soft",
          isDragActive
            ? "border-indigo-500 bg-indigo-50 scale-[1.02] ring-2 ring-indigo-200"
            : "border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/30"
        )}
      >
        <input {...getInputProps()} />
        <AnimatePresence mode="wait">
          {!file ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 border border-indigo-200 flex items-center justify-center">
                <Upload className="w-8 h-8 text-indigo-600" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">
                  {isDragActive ? "Drop candidate resume here" : "Drag & drop candidate resume"}
                </p>
                <p className="text-sm text-slate-500 mt-1">or click to browse (PDF, DOC, DOCX up to 10MB)</p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="file"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex items-center justify-between p-5 bg-white border-2 border-indigo-100 rounded-2xl shadow-soft"
            >
              <div className="flex items-center space-x-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile();
                }}
                className="p-2.5 hover:bg-indigo-100 rounded-xl transition"
              >
                <X className="w-4 h-4 text-primary" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Progress & Actions */}
      <AnimatePresence>
        {file && status !== "processing" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4"
          >
            {status === "uploading" && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-indigo-600 uppercase tracking-wider">
                  <span>Uploading…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2 [&>div]:from-indigo-500 [&>div]:to-violet-500" />
              </div>
            )}

            <Button
              onClick={handleUpload}
              disabled={status === "uploading"}
              className="w-full py-4 text-base rounded-xl bg-primary hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/40 transition-all"
            >
              {status === "uploading" ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Screen Candidate
                </>
              )}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 rounded-xl bg-red-50 border-2 border-red-200 text-red-600 flex items-center space-x-3"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Security Badge */}
      <div className="flex items-center justify-center space-x-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-400 pt-2">
        <Shield className="w-3.5 h-3.5" />
        <span>256-bit encryption — GDPR compliant</span>
      </div>
    </div>
  );
}
