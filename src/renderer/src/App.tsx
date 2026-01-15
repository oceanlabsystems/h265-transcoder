import { useState, useEffect } from "react";
import { Select, ConfigProvider, theme } from "antd";
import { toast, Toaster } from "sonner";
import "@renderer/assets/index.css";

const { Option } = Select;

// Helper function to format time in seconds to readable format
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

// Custom Progress Bar component
function ProgressBar({
  percent,
  color = "cyan",
}: {
  percent: number;
  color?: "cyan" | "green" | "orange";
}) {
  return (
    <div className="progress-bar-container">
      <div
        className={`progress-bar-fill ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

// Folder icon component
function FolderIcon() {
  return (
    <svg
      className="w-4 h-4 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  );
}

// Play icon component
function PlayIcon() {
  return (
    <svg
      className="w-5 h-5 flex-shrink-0"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

// Spinner icon component
function SpinnerIcon() {
  return (
    <svg
      className="w-5 h-5 animate-spin flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function VideoProcessor() {
  const [inputDir, setInputDir] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [chunkDuration, setChunkDuration] = useState<number>(30);
  const [outputFormat, setOutputFormat] = useState<"mp4" | "mkv" | "mov">(
    "mkv"
  );
  const [encoder, setEncoder] = useState<"x265" | "nvh265" | "qsvh265">("x265");
  const [speedPreset, setSpeedPreset] = useState<
    | "ultrafast"
    | "veryfast"
    | "faster"
    | "fast"
    | "medium"
    | "slow"
    | "slower"
    | "veryslow"
  >("medium");
  const [files, setFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [processing, setProcessing] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [fileProgress, setFileProgress] = useState(0);
  const [chunkProgress, setChunkProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [currentChunk, setCurrentChunk] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [eta, setEta] = useState<number | undefined>(undefined);
  const [chunkEta, setChunkEta] = useState<number | undefined>(undefined);
  const [fileEta, setFileEta] = useState<number | undefined>(undefined);
  const [processingSpeed, setProcessingSpeed] = useState<number | undefined>(
    undefined
  );
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const cleanup = window.api.ipcRenderer.on(
      "video:progress-update",
      (status: any) => {
        setOverallProgress(status.overallProgress || status.progress || 0);
        setFileProgress(status.fileProgress || 0);
        setChunkProgress(status.chunkProgress || 0);
        setCurrentFile(status.currentFile || "");
        setCurrentFileIndex(status.currentFileIndex || 0);
        setTotalFiles(status.totalFiles || 0);
        setCurrentChunk(status.currentChunk || 0);
        setTotalChunks(status.totalChunks || 0);
        setEta(status.eta);
        setChunkEta(status.chunkEta);
        setFileEta(status.fileEta);
        setProcessingSpeed(status.processingSpeed);

        if (status.status === "completed") {
          setProcessing(false);
          toast.success(
            `Batch complete! Processed ${status.totalFiles} file(s).`
          );
        } else if (status.status === "error") {
          setProcessing(false);
          toast.error(`Error: ${status.error || "Unknown error"}`);
        }
      }
    );
    return cleanup;
  }, []);

  // Check maximized state periodically
  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await window.api.ipcRenderer.invoke(
        "window:is-maximized"
      );
      setIsMaximized(maximized);
    };
    checkMaximized();
    const interval = setInterval(checkMaximized, 500);
    return () => clearInterval(interval);
  }, []);

  const handleMinimize = async () => {
    await window.api.ipcRenderer.invoke("window:minimize");
  };

  const handleMaximize = async () => {
    await window.api.ipcRenderer.invoke("window:maximize");
    const maximized = await window.api.ipcRenderer.invoke(
      "window:is-maximized"
    );
    setIsMaximized(maximized);
  };

  const handleClose = async () => {
    await window.api.ipcRenderer.invoke("window:close");
  };

  const selectInputDir = async () => {
    const dir = await window.api.ipcRenderer.invoke(
      "video:select-input-directory"
    );
    if (dir) {
      setInputDir(dir);
      const fileList = await window.api.ipcRenderer.invoke(
        "video:scan-directory",
        dir
      );
      setFiles(fileList);
    }
  };

  const selectOutputDir = async () => {
    const dir = await window.api.ipcRenderer.invoke(
      "video:select-output-directory"
    );
    if (dir) setOutputDir(dir);
  };

  const startProcessing = async () => {
    if (!inputDir || !outputDir || files.length === 0) {
      toast.error("Please select input and output directories");
      return;
    }

    setProcessing(true);
    const config = {
      inputDirectory: inputDir,
      outputDirectory: outputDir,
      chunkDurationMinutes: chunkDuration,
      outputFormat,
      encoder,
      speedPreset: encoder === "x265" ? speedPreset : undefined,
    };

    try {
      await window.api.ipcRenderer.invoke("video:start-batch-process", config);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Processing failed: ${errorMessage}`);
      setProcessing(false);
    }
  };

  const canStart = inputDir && outputDir && files.length > 0 && !processing;

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#06b6d4",
          colorBgBase: "#0a0a0f",
          colorText: "#f1f5f9",
          borderRadius: 8,
          fontFamily: "'JetBrains Mono', monospace",
        },
      }}
    >
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#1a1a24",
            color: "#f1f5f9",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            borderRadius: "10px",
            fontFamily: "'Outfit', sans-serif",
          },
          duration: 4000,
        }}
      />

      <div
        className="h-screen flex flex-col overflow-hidden"
        style={{ background: "var(--color-surface)" }}
      >
        {/* Header - responsive padding */}
        <header
          className="window-drag-region flex-shrink-0 px-3 sm:px-4 md:px-6 py-3 md:py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 window-drag-region flex-1">
              <div
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 window-no-drag"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)",
                  boxShadow: "var(--glow-primary)",
                }}
              >
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6 text-gray-900"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" />
                </svg>
              </div>
              <div className="min-w-0 window-drag-region">
                <h1
                  className="text-sm sm:text-base md:text-lg font-semibold truncate"
                  style={{ fontFamily: "'Outfit', sans-serif" }}
                >
                  Video Batch Processor
                </h1>
                <p
                  className="text-[10px] sm:text-xs truncate hidden sm:block"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  H.265 Transcoder with Chunking
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 window-no-drag">
              {processing && (
                <div className="processing-indicator text-xs sm:text-sm flex-shrink-0 mr-2">
                  <SpinnerIcon />
                  <span className="hidden sm:inline">Processing</span>
                </div>
              )}

              {/* Window Controls */}
              <button
                onClick={handleMinimize}
                className="window-control-btn"
                title="Minimize"
              >
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20 12H4"
                  />
                </svg>
              </button>
              <button
                onClick={handleClose}
                className="window-control-btn close"
                title="Close"
              >
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content - scrollable */}
        <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
          <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
            {/* Settings Panel */}
            <div className="glass-panel-elevated p-4 sm:p-5 md:p-6">
              <h2
                className="text-sm sm:text-base font-semibold mb-4 sm:mb-6"
                style={{
                  fontFamily: "'Outfit', sans-serif",
                  color: "var(--color-text)",
                }}
              >
                Encoding Settings
              </h2>

              {/* Responsive grid - single column on small, two on large */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 md:gap-6">
                {/* Left Column - Directories */}
                <div className="space-y-4 sm:space-y-5">
                  {/* Input Directory */}
                  <div>
                    <label className="label-text text-xs sm:text-sm">
                      Input Directory
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inputDir}
                        readOnly
                        placeholder="Select folder with video input files..."
                        className="input-field flex-1 min-w-0 text-xs sm:text-sm py-2 sm:py-2.5"
                      />
                      <button
                        onClick={selectInputDir}
                        className="btn-secondary flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm flex-shrink-0"
                      >
                        <FolderIcon />
                        <span className="hidden sm:inline">Browse</span>
                      </button>
                    </div>
                    {files.length > 0 && (
                      <div className="mt-2">
                        <span className="file-badge text-[10px] sm:text-xs">
                          {files.length} video file
                          {files.length !== 1 ? "s" : ""} found
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Output Directory */}
                  <div>
                    <label className="label-text text-xs sm:text-sm">
                      Output Directory
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={outputDir}
                        readOnly
                        placeholder="Select output folder..."
                        className="input-field flex-1 min-w-0 text-xs sm:text-sm py-2 sm:py-2.5"
                      />
                      <button
                        onClick={selectOutputDir}
                        className="btn-secondary flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm flex-shrink-0"
                      >
                        <FolderIcon />
                        <span className="hidden sm:inline">Browse</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column - Options */}
                <div className="space-y-4 sm:space-y-5">
                  {/* Chunk Duration & Format - responsive grid */}
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="label-text text-xs sm:text-sm">
                        Chunk (min)
                      </label>
                      <input
                        type="number"
                        value={chunkDuration}
                        onChange={(e) =>
                          setChunkDuration(Number(e.target.value))
                        }
                        className="input-field text-xs sm:text-sm py-2 sm:py-2.5"
                        min={1}
                        max={120}
                      />
                    </div>
                    <div>
                      <label className="label-text text-xs sm:text-sm">
                        Output Format
                      </label>
                      <Select
                        value={outputFormat}
                        onChange={setOutputFormat}
                        className="w-full"
                        popupClassName="custom-select-dropdown"
                        size="middle"
                      >
                        <Option value="mkv">MKV</Option>
                        <Option value="mp4">MP4</Option>
                        <Option value="mov">MOV</Option>
                      </Select>
                    </div>
                  </div>

                  {/* Encoder & Speed Preset */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="label-text text-xs sm:text-sm">
                        Encoder
                      </label>
                      <Select
                        value={encoder}
                        onChange={setEncoder}
                        className="w-full"
                        size="middle"
                      >
                        <Option value="x265">x265 (CPU)</Option>
                        <Option value="qsvh265">Intel QSV</Option>
                        <Option value="nvh265">NVIDIA NVENC</Option>
                      </Select>
                    </div>
                    {encoder === "x265" && (
                      <div>
                        <label className="label-text text-xs sm:text-sm">
                          Preset
                        </label>
                        <Select
                          value={speedPreset}
                          onChange={setSpeedPreset}
                          className="w-full"
                          size="middle"
                        >
                          <Option value="ultrafast">Ultrafast</Option>
                          <Option value="veryfast">Very Fast</Option>
                          <Option value="faster">Faster</Option>
                          <Option value="fast">Fast</Option>
                          <Option value="medium">Medium</Option>
                          <Option value="slow">Slow</Option>
                          <Option value="slower">Slower</Option>
                          <Option value="veryslow">Very Slow</Option>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Start Button */}
              <div
                className="mt-4 sm:mt-6 pt-4 sm:pt-6"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <button
                  onClick={startProcessing}
                  disabled={!canStart}
                  className="btn-primary w-full flex items-center justify-center gap-2 text-sm sm:text-base py-2.5 sm:py-3"
                >
                  {processing ? (
                    <>
                      <SpinnerIcon />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <PlayIcon />
                      <span>Start Batch Process</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Progress Panel - Only shown when processing */}
            {processing && (
              <div className="glass-panel p-4 sm:p-5 md:p-6 space-y-4 sm:space-y-5">
                {/* Header with current file info */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs sm:text-sm font-medium truncate"
                      style={{ color: "var(--color-text)" }}
                    >
                      {currentFile || "Starting..."}
                    </p>
                    <p
                      className="text-[10px] sm:text-xs mt-0.5 sm:mt-1"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      File {currentFileIndex} of {totalFiles}
                      {totalChunks > 1 && (
                        <span className="hidden sm:inline">
                          {" "}
                          • {totalChunks} chunks ({chunkDuration} min)
                        </span>
                      )}
                    </p>
                  </div>
                  {processingSpeed !== undefined && (
                    <div className="text-right flex-shrink-0">
                      <p className="stat-value text-base sm:text-lg">
                        {processingSpeed.toFixed(2)}x
                      </p>
                      <p className="stat-label text-[10px] sm:text-xs">Speed</p>
                    </div>
                  )}
                </div>

                {/* Overall Progress */}
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex justify-between items-center flex-wrap gap-1">
                    <span
                      className="text-[10px] sm:text-xs font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Overall
                    </span>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <span className="stat-value text-xs sm:text-sm">
                        {overallProgress}%
                      </span>
                      {eta !== undefined && eta >= 0 && (
                        <span
                          className="text-[10px] sm:text-xs"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {formatTime(eta)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ProgressBar percent={overallProgress} color="cyan" />
                </div>

                {/* File Progress */}
                {currentFile && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <div className="flex justify-between items-center flex-wrap gap-1">
                      <span
                        className="text-[10px] sm:text-xs font-medium"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        File
                      </span>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span
                          className="stat-value text-xs sm:text-sm"
                          style={{ color: "var(--color-success)" }}
                        >
                          {fileProgress}%
                        </span>
                        {fileEta !== undefined && fileEta >= 0 && (
                          <span
                            className="text-[10px] sm:text-xs"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            {formatTime(fileEta)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ProgressBar percent={fileProgress} color="green" />
                  </div>
                )}

                {/* Chunk Progress */}
                {totalChunks > 0 && currentChunk > 0 && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <div className="flex justify-between items-center flex-wrap gap-1">
                      <span
                        className="text-[10px] sm:text-xs font-medium"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Chunk {currentChunk}/{totalChunks}
                      </span>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span
                          className="stat-value text-xs sm:text-sm"
                          style={{ color: "var(--color-warning)" }}
                        >
                          {chunkProgress}%
                        </span>
                        {chunkEta !== undefined && chunkEta >= 0 && (
                          <span
                            className="text-[10px] sm:text-xs"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            {formatTime(chunkEta)}
                          </span>
                        )}
                      </div>
                    </div>
                    <ProgressBar percent={chunkProgress} color="orange" />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Footer - responsive */}
        <footer
          className="flex-shrink-0 px-3 sm:px-6 py-2 sm:py-3 text-center text-[10px] sm:text-xs border-t"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <span className="hidden sm:inline">
            H.265/HEVC Batch Transcoder • GStreamer Pipeline
          </span>
          <span className="sm:hidden">H.265 Transcoder • GStreamer</span>
        </footer>
      </div>
    </ConfigProvider>
  );
}

export default function App(): JSX.Element {
  return <VideoProcessor />;
}
