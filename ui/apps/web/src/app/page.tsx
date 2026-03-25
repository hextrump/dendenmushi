"use client";

import React, { useEffect, useRef, useState } from "react";
import { StreamContext, StreamProvider } from "@/providers/Stream";
import type { TranscriptEntry, Suggestion, SessionSummary, StreamContextType, AudioSource } from "@/providers/Stream";
import { Mic, MicOff, BookOpen, Sparkles, Bot, FileText, Send, Volume2, Trash2, ChevronRight, Settings, Monitor, Upload } from "lucide-react";

export default function DashboardPage() {
  return (
    <StreamProvider>
      <Dashboard />
    </StreamProvider>
  );
}

function Dashboard() {
  const ctx = React.useContext(StreamContext) as StreamContextType;
  const {
    transcript, suggestions, aiDraft,
    isRecording, volume, connectionStatus, summary,
    startRecording, stopRecording, sendSuggestion, sendManualTTS,
    requestSummary, clearSession
  } = ctx;

  const boardEndRef = useRef<HTMLDivElement>(null);
  const agentEndRef = useRef<HTMLDivElement>(null);
  const [manualInput, setManualInput] = useState("");
  const [prepInput, setPrepInput] = useState("");
  const [selectedSource, setSelectedSource] = useState<AudioSource>('mic');
  const [asrLang, setAsrLang] = useState('auto');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [prepChat, setPrepChat] = useState<{role: 'ai'|'user', content: string}[]>([
    { role: 'ai', content: '您好，我是业务代答代理。请在接通语音前输入对方情报或谈判策略。会议开始后，您的设定将作为全局系统提示词生效。' }
  ]);

  // Define derived state first
  const boardEntries = transcript.filter(t => t.speaker === 'user');
  const agentEntries = transcript.filter(t => t.speaker === 'ai');

  // Then effects
  useEffect(() => {
    boardEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    agentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentEntries.length, aiDraft, suggestions.length]);

  // Then handlers
  const handleManualSend = () => {
    if (manualInput.trim()) {
      sendManualTTS(manualInput.trim());
      setManualInput("");
    }
  };

  const handlePrepSubmit = () => {
    if (!prepInput.trim()) return;
    setPrepChat(prev => [...prev, { role: 'user', content: prepInput }]);
    setPrepInput("");
  };

  const handleStartVoice = () => {
    const compiledContext = prepChat.map(m => `${m.role === 'user' ? '用户设定' : '系统提示'}: ${m.content}`).join('\n');
    startRecording(compiledContext, selectedSource, fileUrl || undefined, asrLang);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Revoke old URL
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      const url = URL.createObjectURL(file);
      setFileUrl(url);
      setFileName(file.name);
      setSelectedSource('file');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">

      {/* ═══════════ HEADER ═══════════ */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-slate-800/60 bg-slate-900/40 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <span className="text-sm">🐌</span>
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight leading-none">Den Den Mushi</h1>
            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">v2.0 Realtime</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <StatusDot label="WS" active={connectionStatus.ws} />
            <StatusDot label="ASR" active={connectionStatus.asr} />
            <StatusDot label="TTS" active={connectionStatus.tts} />
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">Agent Proxy</span>
          </div>
        </div>
      </header>

      {/* ═══════════ MAIN LAYOUT ═══════════ */}
      <main className="flex flex-1 overflow-hidden">

        {/* ─── 0. NAV BAR ─── */}
        <nav className="w-16 flex flex-col items-center py-4 bg-slate-950 border-r border-slate-800/60 shrink-0">
          <div className="flex flex-col gap-6 w-full items-center">
            <div className="w-10 h-10 bg-indigo-600/20 text-indigo-400 rounded-xl flex items-center justify-center border border-indigo-500/30 shadow-inner"><BookOpen size={20} /></div>
            <div className="w-10 h-10 text-slate-500 hover:text-slate-300 rounded-xl flex items-center justify-center cursor-pointer hover:bg-slate-800 transition-colors"><Mic size={20} /></div>
            <div className="w-10 h-10 text-slate-500 hover:text-slate-300 rounded-xl flex items-center justify-center cursor-pointer hover:bg-slate-800 transition-colors"><Sparkles size={20} /></div>
            <div className="w-10 h-10 text-slate-500 hover:text-slate-300 rounded-xl flex items-center justify-center cursor-pointer hover:bg-slate-800 transition-colors mt-auto"><Settings size={20} /></div>
          </div>
        </nav>

        {/* ─── 1. PREP CONTEXT (LEFT) ─── */}
        <section className="w-80 flex flex-col border-r border-slate-800/40 bg-slate-900/30 shrink-0">
          <SectionHeader icon={<FileText size={13} />} title="Context / 对话设定" subtitle="会前背景输入" />
          <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
            {prepChat.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in`}>
                <div className={`max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                  msg.role === 'user' ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-100 rounded-tr-sm' 
                  : 'bg-slate-800 border border-slate-700/50 text-slate-300 rounded-tl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-3 border-t border-slate-800/40 bg-slate-900/50 space-y-2">
            {!isRecording ? (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={prepInput}
                    onChange={e => setPrepInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handlePrepSubmit()}
                    placeholder="配置策略..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] placeholder-slate-700 focus:outline-none focus:border-indigo-500/50"
                  />
                  <button onClick={handlePrepSubmit} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors flex items-center justify-center"><Send size={12} /></button>
                </div>

                {/* ─── Audio Source Selector ─── */}
                <div className="flex gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setSelectedSource('mic')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                      selectedSource === 'mic' ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Mic size={12} /> 麦克风
                  </button>
                  <button
                    onClick={() => setSelectedSource('screen')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                      selectedSource === 'screen' ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Monitor size={12} /> 系统音频
                  </button>
                  <label
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all cursor-pointer ${
                      selectedSource === 'file' ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40' : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Upload size={12} /> 文件
                    <input type="file" accept="audio/*,video/*" onChange={handleFileSelect} className="hidden" />
                  </label>
                </div>

                {/* File name indicator */}
                {selectedSource === 'file' && fileName && (
                  <div className="text-[10px] text-amber-400/70 truncate px-1 flex items-center gap-1">
                    <FileText size={10} /> {fileName}
                  </div>
                )}

                {/* Screen capture hint */}
                {selectedSource === 'screen' && (
                  <div className="text-[10px] text-blue-400/50 px-1 leading-tight">
                    💡 捕获Zoom/Teams/Meet等会议音频。请在弹窗中勾选「分享音频」。
                  </div>
                )}

                {/* ─── ASR Language ─── */}
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-600 font-bold uppercase tracking-tight shrink-0">识别语言</span>
                  <select 
                    value={asrLang} 
                    onChange={e => setAsrLang(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                  >
                    <option value="auto">🌐 自动检测</option>
                    <option value="ja">🇯🇵 日本語</option>
                    <option value="zh">🇨🇳 中文</option>
                    <option value="en">🇺🇸 English</option>
                    <option value="ko">🇰🇷 한국어</option>
                  </select>
                </div>
                <button 
                  onClick={handleStartVoice}
                  disabled={selectedSource === 'file' && !fileUrl}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/20"
                >
                  {selectedSource === 'mic' && <><Mic size={14} /> 开始语音互动</>}
                  {selectedSource === 'screen' && <><Monitor size={14} /> 捕获会议音频</>}
                  {selectedSource === 'file' && <><Upload size={14} /> 开始解析文件</>}
                </button>
              </>
            ) : (
              <button onClick={stopRecording} className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                <MicOff size={14} /> 结束当前会话
              </button>
            )}
          </div>
        </section>

        {/* ─── 2. BOARD (CENTER) ─── */}
        <section className="flex-[3] flex flex-col border-r border-slate-800/40">
          <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800/40 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <BookOpen size={13} /> Board / 看板区
            </span>
            <div className="flex items-center gap-3 text-[9px] font-bold text-slate-600">
              <button onClick={clearSession} className="hover:text-rose-400 uppercase tracking-widest flex items-center gap-1 transition-colors"><Trash2 size={10} /> 清空记录</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
            {boardEntries.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
                <Mic size={48} className="mb-4 text-slate-700" />
                <p className="text-sm font-medium">转录与翻译将在此显示</p>
              </div>
            )}
            {boardEntries.map((entry) => (
              <TranscriptBubble key={entry.id} entry={entry} />
            ))}
            <div ref={boardEndRef} />
          </div>
        </section>

        {/* ─── 3. MULTI-LANE SIDEPANEL (RIGHT) ─── */}
        <aside className="flex-[2] flex flex-col bg-slate-900/40 min-w-[340px] border-l border-slate-800/40 shadow-xl overflow-hidden">
          
          {/* LANE 1: SUMMARY (TOP) */}
          <div className="flex-[4] flex flex-col border-b border-white/5 bg-emerald-950/5 min-h-[220px]">
            <div className="px-4 py-2 bg-emerald-950/20 border-b border-emerald-500/10 flex items-center justify-between shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Summary / 会议摘要
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
              {!summary ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-20 py-10">
                  <FileText size={24} className="mb-2" />
                  <p className="text-[10px] uppercase tracking-widest">后台自动生成中...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[12.5px] text-slate-200 leading-relaxed bg-slate-950/50 p-3 rounded-xl border border-emerald-500/10 shadow-inner italic">
                    {summary.overview}
                  </p>
                  <div className="space-y-3">
                    {summary.key_points?.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-[9px] font-bold text-emerald-500/50 uppercase tracking-widest flex items-center gap-1">Key Highlights</span>
                        <ul className="space-y-1.5 pl-1">
                          {summary.key_points.map((pt, i) => (
                            <li key={i} className="text-[11px] text-slate-400 flex gap-2 leading-snug">
                              <span className="text-emerald-500/40 shrink-0">•</span><span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(summary.action_items?.length > 0 || summary.decisions?.length > 0) && (
                      <div className="space-y-2 pt-2 border-t border-white/5">
                        <span className="text-[9px] font-bold text-amber-500/50 uppercase tracking-widest flex items-center gap-1">Takeaways</span>
                        <ul className="space-y-1.5 pl-1">
                          {[...(summary.decisions || []), ...(summary.action_items || [])].map((v, i) => (
                            <li key={i} className="text-[11px] text-amber-100/60 flex gap-2 leading-snug">
                              <span className="text-amber-500/30 shrink-0 select-none">✓</span><span>{v}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* LANE 2: ACTION FEED (BOTTOM) */}
          <div className="flex-[6] flex flex-col overflow-hidden bg-indigo-950/5">
            <div className="px-4 py-2 bg-indigo-950/20 border-b border-indigo-500/10 flex items-center justify-between shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-1.5">
                <Sparkles size={13} /> Action & Proxy / 副驾与接管
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-5" style={{ scrollbarWidth: 'thin' }}>
              {agentEntries.length === 0 && !aiDraft && suggestions.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-10 py-10">
                  <Bot size={32} />
                  <p className="text-[10px] uppercase font-bold tracking-widest mt-2">待机中</p>
                </div>
              )}
              {agentEntries.map(entry => (
                <div key={entry.id} className="relative group p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl hover:border-indigo-500/20 transition-all shadow-sm">
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="text-[9px] font-bold text-indigo-400/50 uppercase tracking-widest flex items-center gap-1"><Bot size={10}/> Proxy History</span>
                    <button onClick={() => sendManualTTS(entry.text)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-indigo-600/30 hover:bg-indigo-600 text-white rounded flex items-center justify-center"><Volume2 size={11} /></button>
                  </div>
                  <p className="text-[13px] text-slate-300 leading-relaxed font-light">{entry.text}</p>
                </div>
              ))}
              {(aiDraft || suggestions.length > 0) && (
                <div className="space-y-4 pt-4 border-t border-slate-800/60 relative">
                  <div className="absolute -top-[9px] left-1/2 -translate-x-1/2 px-2 bg-slate-900/60 text-[9px] uppercase font-bold tracking-tighter text-emerald-400 border border-slate-800/60 rounded-full">New Suggestions</div>
                  {aiDraft && (
                    <div className="p-4 bg-gradient-to-br from-indigo-900/40 to-violet-900/20 border border-indigo-500/30 rounded-xl shadow-lg shadow-indigo-500/5">
                      <span className="text-[9px] font-bold text-indigo-300 uppercase block mb-2 opacity-70">Proposed Response</span>
                      <p className="text-[15px] text-white leading-relaxed font-normal mb-4">{aiDraft}</p>
                      <button onClick={() => sendManualTTS(aiDraft)} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-indigo-600/20">
                        <Volume2 size={14} /> 一键接管 (TTS)
                      </button>
                    </div>
                  )}
                  {suggestions.length > 0 && (
                    <div className="grid gap-2">
                       {suggestions.map((sug) => (
                        <div key={sug.id} onClick={() => sendSuggestion(sug.text)} className="group p-3 bg-slate-800/40 hover:bg-indigo-900/40 border border-slate-700/50 hover:border-indigo-500/50 rounded-xl transition-all cursor-pointer">
                          <p className="text-[13px] text-slate-200 leading-relaxed mb-3">{sug.text}</p>
                          <div className="flex justify-end"><span className="text-[10px] px-3 py-1.5 bg-slate-800 rounded-lg text-slate-400 font-bold uppercase group-hover:bg-indigo-600 group-hover:text-white transition-all shadow flex items-center gap-1.5"><Volume2 size={12}/> 发送语音</span></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div ref={agentEndRef} />
            </div>
          </div>

          {/* INPUT (BOTTOM) */}
          <div className="px-3 py-3 border-t border-slate-800/40 bg-slate-950/60 shrink-0">
            <div className="flex gap-2">
              <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleManualSend()} placeholder="手动接管发言..." className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs placeholder-slate-700 focus:outline-none focus:border-indigo-500/50" />
              <button onClick={handleManualSend} disabled={!manualInput.trim()} className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 rounded-lg transition-all shadow-lg active:scale-95 flex items-center justify-center"><Send size={14} /></button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

// ─── Sub-components ───

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800/40 flex items-center justify-between shrink-0">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">{icon} {title}</span>
      <span className="text-[9px] text-slate-600 font-mono italic">{subtitle}</span>
    </div>
  );
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-700'}`} />
      <span className={`text-[9px] font-bold tracking-tighter ${active ? 'text-emerald-500' : 'text-slate-700'}`}>{label}</span>
    </div>
  );
}

function TranscriptBubble({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.speaker === 'user';
  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
      <div className="max-w-[92%]">
        <div className={`px-4 py-3 rounded-2xl ${
          isUser ? 'bg-slate-900/90 border border-slate-800/80 rounded-bl-none shadow-sm' 
          : 'bg-indigo-600/10 border border-indigo-500/20 rounded-br-none'
        }`}>
          <p className={`text-[14px] leading-relaxed tracking-tight ${!entry.finalized ? 'opacity-50 italic' : 'text-slate-100'}`}>
            {entry.text}
            {!entry.finalized && <span className="inline-block w-1 h-3 bg-indigo-500 ml-1 animate-pulse" />}
          </p>
        </div>
        {entry.translation && (
          <div className={`mt-1.5 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10 ${isUser ? '' : 'ml-auto'}`}>
            <p className="text-[12px] text-amber-100/70 leading-normal italic">「 {entry.translation} 」</p>
          </div>
        )}
        <div className={`mt-1 flex items-center gap-2 px-1 text-[9px] text-slate-700 font-bold uppercase tracking-widest ${isUser ? '' : 'justify-end'}`}>
          <span>{isUser ? 'User' : 'Agent'}</span>
          <span className="opacity-30">·</span>
          <span>{time}</span>
        </div>
      </div>
    </div>
  );
}
