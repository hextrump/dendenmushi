import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useRef,
  useCallback
} from "react";
import { v4 as uuidv4 } from "uuid";

// ─── Types ───────────────────────────────────────
// Audio input source types
export type AudioSource = 'mic' | 'screen' | 'file';

export interface TranscriptEntry {
  id: string;
  speaker: "user" | "ai";
  text: string;
  translation?: string;
  timestamp: number;
  finalized: boolean;
}

export interface Suggestion {
  id: string;
  text: string;
  type: string;
}

export interface SessionSummary {
  overview: string;
  key_points: string[];
  decisions: string[];
  action_items: string[];
  duration_sec?: number;
}

export interface StreamContextType {
  // Board data
  transcript: TranscriptEntry[];
  // Copilot data
  suggestions: Suggestion[];
  // Agent data
  aiDraft: string;
  // Controls
  isRecording: boolean;
  isLoading: boolean;
  volume: number;
  connectionStatus: { asr: boolean; tts: boolean; ws: boolean };
  summary: SessionSummary | null;
  audioSource: AudioSource;
  // Actions
  startRecording: (context?: string, source?: AudioSource, fileUrl?: string, asrLanguage?: string) => Promise<void>;
  stopRecording: () => void;
  sendSuggestion: (text: string) => void;
  sendManualTTS: (text: string) => void;
  requestSummary: () => void;
  clearSession: () => void;
  // Legacy compat
  messages: any[];
  error: Error | null;
  submit: (...args: any[]) => Promise<void>;
  stop: () => void;
  getMessagesMetadata: () => any;
  setBranch: (id: string) => void;
  interrupt: (() => void) | null;
  values: { ui: any[] };
  audioUrl: string | null;
}

export const StreamContext = createContext<StreamContextType | null>(null);

export const StreamProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Board state
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  // Copilot state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // Agent state
  const [aiDraft, setAiDraft] = useState("");
  // UI state
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState({ asr: false, tts: false, ws: false });
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>('mic');

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const recordingContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const fileAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const currentUserEntryRef = useRef<string | null>(null);
  const currentAiEntryRef = useRef<string | null>(null);

  // ─── WebSocket ──────────────────────────────
  const connectWebSocket = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:8080');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WS Connected");
        setConnectionStatus(prev => ({ ...prev, ws: true }));
        ws.send(JSON.stringify({ type: 'start' }));
        resolve();
      };

      ws.onerror = () => reject(new Error("WS failed"));

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      };

      ws.onclose = () => {
        setConnectionStatus({ asr: false, tts: false, ws: false });
        setIsLoading(false);
      };
    });
  }, []);

  const handleServerMessage = useCallback((data: any) => {
    switch (data.type) {
      // System status
      case 'system':
        if (data.status === 'asr_connected') setConnectionStatus(prev => ({ ...prev, asr: true }));
        if (data.status === 'tts_connected') setConnectionStatus(prev => ({ ...prev, tts: true }));
        break;

      // ASR partial — replace text incrementally
      case 'asr_partial': {
        let entryId = currentUserEntryRef.current;
        if (!entryId) {
          entryId = uuidv4();
          currentUserEntryRef.current = entryId;
          setTranscript(prev => [...prev, { id: entryId as string, speaker: 'user', text: data.text, timestamp: Date.now(), finalized: false }]);
        } else {
          setTranscript(prev => prev.map(e => e.id === entryId ? { ...e, text: data.text } : e));
        }
        break;
      }

      // ASR final — finalize user entry
      case 'asr_final': {
        let entryId = currentUserEntryRef.current;
        if (!entryId) {
          entryId = uuidv4();
          setTranscript(prev => [...prev, { id: entryId as string, speaker: 'user', text: data.text, timestamp: Date.now(), finalized: true }]);
        } else {
          setTranscript(prev => prev.map(e => e.id === entryId ? { ...e, text: data.text, finalized: true } : e));
        }
        currentUserEntryRef.current = null;
        break;
      }

      // Translation — attach to matching transcript entry
      case 'translation':
        setTranscript(prev => {
          // Find the entry whose text matches original
          const idx = [...prev].reverse().findIndex(e => e.text === data.original);
          if (idx >= 0) {
            const realIdx = prev.length - 1 - idx;
            const updated = [...prev];
            updated[realIdx] = { ...updated[realIdx], translation: data.translated };
            return updated;
          }
          return prev;
        });
        break;

      // LLM streaming tokens — build AI draft
      case 'llm_token': {
        setAiDraft(prev => prev + data.text);
        let entryId = currentAiEntryRef.current;
        if (!entryId) {
          entryId = uuidv4();
          currentAiEntryRef.current = entryId;
          setTranscript(prev => [...prev, { id: entryId as string, speaker: 'ai', text: data.text, timestamp: Date.now(), finalized: false }]);
        } else {
          setTranscript(prev => prev.map(e => e.id === entryId ? { ...e, text: e.text + data.text } : e));
        }
        break;
      }

      // LLM done
      case 'llm_done': {
        let entryId = currentAiEntryRef.current;
        if (entryId) {
          setTranscript(prev => prev.map(e => e.id === entryId ? { ...e, finalized: true } : e));
        }
        currentAiEntryRef.current = null;
        setAiDraft("");
        break;
      }

      // Copilot suggestions
      case 'suggestions':
        setSuggestions(data.suggestions || []);
        break;

      // TTS audio chunk
      case 'tts_audio':
        console.log('[FE] Received tts_audio chunk, size:', data.audio?.length);
        playTTSChunk(data.audio);
        break;

      // TTS done
      case 'tts_done':
        console.log('[FE] TTS playback done signal');
        break;

      // Session summary
      case 'summary':
        setSummary(data.data);
        break;

      // Suggestion sent confirmation
      case 'suggestion_sent':
        // setSuggestions([]); // Disabled clearing to allow picking multiple or reviewing selection
        break;
    }
  }, []);

  // ─── TTS Playback ──────────────────────────
  const playTTSChunk = useCallback((base64Audio: string) => {
    if (!playbackContextRef.current) {
      playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = playbackContextRef.current;

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    if (int16.length === 0) return; // Prevent DOMException for 0-length buffer

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x7FFF;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const curTime = ctx.currentTime;
    // Add small playback buffer (300ms) to prevent jitter/cut-offs on slow networks
    if (nextPlayTimeRef.current < curTime + 0.3) nextPlayTimeRef.current = curTime + 0.3;
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;
  }, []);

  // ─── Volume Loop ──────────────────────────
  const startVolumeLoop = useCallback(() => {
    const update = () => {
      if (!isRecordingRef.current) return;
      const analyser = analyserRef.current;
      if (!analyser) return;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      setVolume(sum / buf.length);
      animFrameRef.current = requestAnimationFrame(update);
    };
    animFrameRef.current = requestAnimationFrame(update);
  }, []);

  // ─── Recording Controls ────────────────────
  // ─── Acquire MediaStream based on source type ─────
  const acquireStream = useCallback(async (source: AudioSource, fileUrl?: string): Promise<MediaStream> => {
    switch (source) {
      case 'mic':
        return navigator.mediaDevices.getUserMedia({ audio: true });

      case 'screen': {
        // getDisplayMedia captures system audio + screen
        // User can share a browser tab (e.g. Zoom web), entire screen, or window
        const stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,  // Request system audio
          video: true,  // Required by spec, we'll ignore the video track
        });
        // Remove video tracks — we only need audio
        stream.getVideoTracks().forEach(t => t.stop());
        if (stream.getAudioTracks().length === 0) {
          throw new Error('未捕获到系统音频。请在共享时勾选「分享音频」选项。');
        }
        return stream;
      }

      case 'file': {
        if (!fileUrl) throw new Error('No file URL provided');
        // Create a hidden HTMLAudioElement and route through AudioContext
        const audio = new Audio(fileUrl);
        audio.crossOrigin = 'anonymous';
        audio.loop = false;
        fileAudioRef.current = audio;

        // We need an AudioContext to create a MediaStream from the element
        const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const mediaSource = tempCtx.createMediaElementSource(audio);
        const dest = tempCtx.createMediaStreamDestination();
        mediaSource.connect(dest);
        mediaSource.connect(tempCtx.destination); // Also play locally
        audio.play();

        // When file ends, trigger stop
        audio.onended = () => {
          stopRecording();
        };

        return dest.stream;
      }

      default:
        return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }, []);

  const startRecording = useCallback(async (contextString: string = "", source: AudioSource = 'mic', fileUrl?: string, asrLanguage: string = 'auto') => {
    try {
      setAudioSource(source);
      setIsRecording(true);
      isRecordingRef.current = true;
      setIsLoading(true);
      setSuggestions([]);
      setAiDraft("");
      currentUserEntryRef.current = null;
      currentAiEntryRef.current = null;

      // Connect WebSocket with context
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket('ws://localhost:8080');
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WS Connected");
          setConnectionStatus(prev => ({ ...prev, ws: true }));
          ws.send(JSON.stringify({ type: 'start', context: contextString, audioSource: source, asrLanguage }));
          resolve();
        };

        ws.onerror = () => reject(new Error("WS failed"));

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          handleServerMessage(data);
        };

        ws.onclose = () => {
          setConnectionStatus({ asr: false, tts: false, ws: false });
          setIsLoading(false);
        };
      });

      if (!recordingContextRef.current || recordingContextRef.current.state === 'closed') {
        recordingContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      } else if (recordingContextRef.current.state === 'suspended') {
        await recordingContextRef.current.resume();
      }

      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      nextPlayTimeRef.current = playbackContextRef.current.currentTime;

      // Acquire stream from selected source
      const stream = await acquireStream(source, fileUrl);
      mediaStreamRef.current = stream;
      const recCtx = recordingContextRef.current;
      const audioSourceNode = recCtx.createMediaStreamSource(stream);

      const analyser = recCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      await recCtx.audioWorklet.addModule('/audio-processor.js');
      const workletNode = new AudioWorkletNode(recCtx, 'pcm-processor');
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(e.data.buffer);
      };

      audioSourceNode.connect(analyser);
      analyser.connect(workletNode);
      workletNode.connect(recCtx.destination);
      startVolumeLoop();
    } catch (err: any) {
      console.error("startRecording error:", err);
      alert(err?.message || '音频捕获失败');
      setIsRecording(false);
      isRecordingRef.current = false;
      setIsLoading(false);
    }
  }, [connectWebSocket, startVolumeLoop, acquireStream]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    isRecordingRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    setVolume(0);

    if (workletNodeRef.current) try { workletNodeRef.current.disconnect(); } catch(e) {}
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    // Stop file playback if applicable
    if (fileAudioRef.current) {
      fileAudioRef.current.pause();
      fileAudioRef.current.src = '';
      fileAudioRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  // ─── User Actions ──────────────────────────
  const sendSuggestion = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'send_suggestion', text }));
    }
  }, []);

  const sendManualTTS = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'manual_tts', text }));
    }
  }, []);

  const requestSummary = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_summary' }));
    }
  }, []);

  const clearSession = useCallback(() => {
    setTranscript([]);
    setSuggestions([]);
    setAiDraft("");
    setSummary(null);
  }, []);

  const stop = useCallback(() => { setIsLoading(false); stopRecording(); }, [stopRecording]);

  return (
    <StreamContext.Provider value={{
      transcript, suggestions, aiDraft,
      isRecording, isLoading, volume, connectionStatus, summary, audioSource,
      startRecording, stopRecording, sendSuggestion, sendManualTTS, requestSummary, clearSession,
      // Legacy compat
      messages: transcript.map(t => ({ id: t.id, type: t.speaker === 'user' ? 'human' : 'ai', content: t.text })),
      error: null, submit: async () => {}, stop, getMessagesMetadata: () => ({}),
      setBranch: () => {}, interrupt: null, values: { ui: [] }, audioUrl: null,
    }}>
      {children}
    </StreamContext.Provider>
  );
};

export const useStreamContext = () => {
  const context = useContext(StreamContext);
  if (!context) throw new Error("useStreamContext must be used within a StreamProvider");
  return context;
};

export default StreamContext;
