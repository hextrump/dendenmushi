"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { StreamContext, StreamProvider } from "@/providers/Stream";
import type { TranscriptEntry, Suggestion, SessionSummary, StreamContextType, AudioSource } from "@/providers/Stream";
import { Mic, MicOff, BookOpen, Sparkles, Bot, FileText, Send, Volume2, Trash2, Monitor, Upload, Plus, Search, MessageSquare, Paperclip, X, ChevronDown } from "lucide-react";

export default function DashboardPage() {
  return (
    <StreamProvider>
      <Dashboard />
    </StreamProvider>
  );
}

// ─── Session history type ─────────────────────
interface SessionRecord {
  id: string;
  title: string;
  timestamp: number;
  preview: string;
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
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [manualInput, setManualInput] = useState("");
  const [prepInput, setPrepInput] = useState("");
  const [selectedSource, setSelectedSource] = useState<AudioSource>('mic');
  const [asrLang, setAsrLang] = useState('auto');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedDocs, setAttachedDocs] = useState<{name: string, content: string}[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([
    { id: '1', title: '便利店面试代答', timestamp: Date.now() - 86400000, preview: '山本面试准备...' },
  ]);
  const [prepChat, setPrepChat] = useState<{role: 'ai'|'user', content: string}[]>([
    { role: 'ai', content: '请在接通前设定接线员人设、对方情报、准备话术。可以拖入参考文档，也可以直接输入策略。' }
  ]);

  // Derived state
  const boardEntries = transcript.filter(t => t.speaker === 'user');
  const agentEntries = transcript.filter(t => t.speaker === 'ai');

  useEffect(() => {
    boardEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    agentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentEntries.length, aiDraft, suggestions.length]);

  // ─── Handlers ─────────────────────────────────
  const handleManualSend = () => {
    if (manualInput.trim()) {
      sendManualTTS(manualInput.trim());
      setManualInput("");
    }
  };

  const handlePrepSubmit = () => {
    if (!prepInput.trim()) return;
    setPrepChat(prev => [...prev, { role: 'user', content: prepInput }]);
    // TODO: Call LLM to generate assistant response for prep discussion
    // For now, echo a placeholder response
    const userMsg = prepInput;
    setPrepInput("");
    // Simulate assistant thinking
    setTimeout(() => {
      setPrepChat(prev => [...prev, { role: 'ai', content: `收到。我会根据「${userMsg}」来准备话术。还有其他需要注意的吗？` }]);
    }, 500);
  };

  const handleStartVoice = () => {
    // Compile context from prep chat + attached docs
    const chatContext = prepChat.map(m => `${m.role === 'user' ? '用户设定' : '系统提示'}: ${m.content}`).join('\n');
    const docContext = attachedDocs.length > 0
      ? '\n\n--- 参考资料 ---\n' + attachedDocs.map(d => `[${d.name}]\n${d.content}`).join('\n\n')
      : '';
    startRecording(chatContext + docContext, selectedSource, fileUrl || undefined, asrLang);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      const url = URL.createObjectURL(file);
      setFileUrl(url);
      setFileName(file.name);
      setSelectedSource('file');
    }
  };

  const handleNewSession = () => {
    // Save current session to history
    if (transcript.length > 0) {
      const firstMsg = transcript[0]?.text?.substring(0, 30) || '新会话';
      setSessions(prev => [{
        id: Date.now().toString(),
        title: firstMsg + '...',
        timestamp: Date.now(),
        preview: transcript.slice(-1)[0]?.text?.substring(0, 50) || ''
      }, ...prev]);
    }
    clearSession();
    setPrepChat([
      { role: 'ai', content: '请在接通前设定接线员人设、对方情报、准备话术。可以拖入参考文档，也可以直接输入策略。' }
    ]);
    setAttachedDocs([]);
  };

  // ─── Drag & Drop for documents ────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        setAttachedDocs(prev => [...prev, { name: file.name, content: content.substring(0, 5000) }]);
        setPrepChat(prev => [...prev, 
          { role: 'user', content: `📎 已上传文档: ${file.name}` },
          { role: 'ai', content: `收到「${file.name}」，内容已加载为参考资料。我会将其纳入会话背景。` }
        ]);
      };
      reader.readAsText(file);
    });
  }, []);

  const removeDoc = (idx: number) => {
    setAttachedDocs(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">

      {/* ═══════════ LEFT SIDEBAR (SESSION LIST) ═══════════ */}
      <aside className="w-64 flex flex-col bg-slate-900/60 border-r border-slate-800/40 shrink-0">
        {/* Logo */}
        <div className="px-4 py-3 flex items-center gap-2.5 border-b border-slate-800/40">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 text-sm">🐌</div>
          <span className="text-sm font-semibold tracking-tight">Den Den Mushi</span>
        </div>

        {/* New + Search */}
        <div className="px-3 py-2.5 space-y-1.5">
          <button 
            onClick={handleNewSession}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800/60 hover:border-slate-700"
          >
            <Plus size={14} /> 新建对话
          </button>
          {showSearch ? (
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2">
              <Search size={12} className="text-slate-600 shrink-0" />
              <input 
                type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索对话..." autoFocus
                onBlur={() => { if (!searchQuery) setShowSearch(false); }}
                className="flex-1 bg-transparent py-1.5 text-xs placeholder-slate-700 focus:outline-none"
              />
              <button onClick={() => { setSearchQuery(''); setShowSearch(false); }}><X size={10} className="text-slate-700" /></button>
            </div>
          ) : (
            <button 
              onClick={() => setShowSearch(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 rounded-lg transition-colors"
            >
              <Search size={14} /> 搜索对话
            </button>
          )}
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-2" style={{ scrollbarWidth: 'thin' }}>
          <div className="px-2 py-1.5 text-[9px] font-bold text-slate-600 uppercase tracking-widest">历史对话</div>
          {sessions
            .filter(s => !searchQuery || s.title.includes(searchQuery) || s.preview.includes(searchQuery))
            .map(session => (
            <button 
              key={session.id}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-800/60 transition-colors group mb-0.5"
            >
              <div className="flex items-center gap-2">
                <MessageSquare size={13} className="text-slate-600 shrink-0" />
                <span className="text-[12px] text-slate-400 group-hover:text-slate-200 truncate">{session.title}</span>
              </div>
              <div className="text-[10px] text-slate-700 ml-[21px] mt-0.5 truncate">{session.preview}</div>
            </button>
          ))}
        </div>

        {/* Connection status footer */}
        <div className="px-3 py-2 border-t border-slate-800/40 flex items-center gap-3 text-[9px]">
          <StatusDot label="WS" active={connectionStatus.ws} />
          <StatusDot label="ASR" active={connectionStatus.asr} />
          <StatusDot label="TTS" active={connectionStatus.tts} />
        </div>
      </aside>

      {/* ═══════════ CONTEXT / PREP PANEL ═══════════ */}
      <section 
        ref={dropZoneRef}
        className={`w-80 flex flex-col border-r shrink-0 transition-colors ${
          isDragOver ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-800/40 bg-slate-900/30'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800/40 flex items-center justify-between shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <FileText size={13} /> 对话设定 / Context
          </span>
          <label className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 cursor-pointer transition-colors">
            <Paperclip size={10} /> 附件
            <input type="file" accept=".txt,.md,.csv,.json,.pdf,.doc,.docx" multiple onChange={(e) => {
              const files = Array.from(e.target.files || []);
              files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  setAttachedDocs(prev => [...prev, { name: file.name, content: (ev.target?.result as string).substring(0, 5000) }]);
                  setPrepChat(prev => [...prev, 
                    { role: 'user', content: `📎 已上传文档: ${file.name}` },
                    { role: 'ai', content: `收到「${file.name}」，已加载为参考资料。` }
                  ]);
                };
                reader.readAsText(file);
              });
              e.target.value = '';
            }} className="hidden" />
          </label>
        </div>

        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-50 bg-indigo-950/80 backdrop-blur-sm flex items-center justify-center pointer-events-none rounded-lg m-1">
            <div className="text-center">
              <Upload size={32} className="text-indigo-400 mx-auto mb-2 animate-bounce" />
              <p className="text-sm text-indigo-300 font-medium">拖放文档到此处</p>
              <p className="text-[10px] text-indigo-400/50 mt-1">支持 .txt .md .csv .json 等文本格式</p>
            </div>
          </div>
        )}

        {/* Attached docs bar */}
        {attachedDocs.length > 0 && (
          <div className="px-3 py-1.5 border-b border-slate-800/40 flex gap-1.5 flex-wrap bg-slate-950/30">
            {attachedDocs.map((doc, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded-md text-[10px] text-indigo-300">
                <FileText size={9} /> {doc.name.length > 15 ? doc.name.substring(0, 12) + '...' : doc.name}
                <button onClick={() => removeDoc(i)} className="hover:text-rose-400 ml-0.5"><X size={8} /></button>
              </span>
            ))}
          </div>
        )}

        {/* Prep chat */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: 'thin' }}>
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

        {/* Bottom controls */}
        <div className="px-3 py-2.5 border-t border-slate-800/40 bg-slate-900/50 space-y-2">
          {!isRecording ? (
            <>
              <div className="flex gap-1.5">
                <input
                  type="text" value={prepInput}
                  onChange={e => setPrepInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePrepSubmit()}
                  placeholder="输入人设、策略、对方情报..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] placeholder-slate-700 focus:outline-none focus:border-indigo-500/50"
                />
                <button onClick={handlePrepSubmit} className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 transition-colors"><Send size={12} /></button>
              </div>

              {/* Audio source + Language */}
              <div className="flex gap-1 p-0.5 bg-slate-950 rounded-lg border border-slate-800">
                <button onClick={() => setSelectedSource('mic')}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-bold transition-all ${
                    selectedSource === 'mic' ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'text-slate-600 hover:text-slate-400'
                  }`}><Mic size={10} /> 麦克风</button>
                <button onClick={() => setSelectedSource('screen')}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-bold transition-all ${
                    selectedSource === 'screen' ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40' : 'text-slate-600 hover:text-slate-400'
                  }`}><Monitor size={10} /> 系统音频</button>
                <label className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-bold transition-all cursor-pointer ${
                    selectedSource === 'file' ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40' : 'text-slate-600 hover:text-slate-400'
                  }`}><Upload size={10} /> 文件
                  <input type="file" accept="audio/*,video/*" onChange={handleFileSelect} className="hidden" />
                </label>
              </div>

              {selectedSource === 'file' && fileName && (
                <div className="text-[9px] text-amber-400/70 truncate px-1 flex items-center gap-1"><FileText size={9} /> {fileName}</div>
              )}
              {selectedSource === 'screen' && (
                <div className="text-[9px] text-blue-400/50 px-1 leading-tight">💡 请在弹窗中勾选「分享音频」</div>
              )}

              <div className="flex items-center gap-1.5">
                <select value={asrLang} onChange={e => setAsrLang(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-400 focus:outline-none cursor-pointer">
                  <option value="auto">🌐 自动检测</option>
                  <option value="ja">🇯🇵 日本語</option>
                  <option value="zh">🇨🇳 中文</option>
                  <option value="en">🇺🇸 English</option>
                  <option value="ko">🇰🇷 한국어</option>
                </select>
              </div>

              <button onClick={handleStartVoice} disabled={selectedSource === 'file' && !fileUrl}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/20">
                {selectedSource === 'mic' && <><Mic size={13} /> 接通</>}
                {selectedSource === 'screen' && <><Monitor size={13} /> 捕获会议</>}
                {selectedSource === 'file' && <><Upload size={13} /> 解析文件</>}
              </button>
            </>
          ) : (
            <button onClick={stopRecording} className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2">
              <MicOff size={13} /> 挂断
            </button>
          )}
        </div>
      </section>

      {/* ═══════════ CENTER: BOARD ═══════════ */}
      <section className="flex-[3] flex flex-col border-r border-slate-800/40">
        <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-800/40 flex items-center justify-between shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <BookOpen size={13} /> Board / 看板区
          </span>
          <div className="flex items-center gap-3 text-[9px] font-bold text-slate-600">
            <button onClick={clearSession} className="hover:text-rose-400 uppercase tracking-widest flex items-center gap-1 transition-colors"><Trash2 size={10} /> 清空</button>
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

      {/* ═══════════ RIGHT: MULTI-LANE ═══════════ */}
      <aside className="flex-[2] flex flex-col bg-slate-900/40 min-w-[320px] shadow-xl overflow-hidden">
        {/* LANE 1: SUMMARY */}
        <div className="flex-[4] flex flex-col border-b border-white/5 bg-emerald-950/5 min-h-[200px]">
          <div className="px-4 py-2 bg-emerald-950/20 border-b border-emerald-500/10 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Summary
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
                <p className="text-[12.5px] text-slate-200 leading-relaxed bg-slate-950/50 p-3 rounded-xl border border-emerald-500/10 shadow-inner italic">{summary.overview}</p>
                {summary.key_points?.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[9px] font-bold text-emerald-500/50 uppercase tracking-widest">Key Points</span>
                    <ul className="space-y-1.5 pl-1">
                      {summary.key_points.map((pt, i) => (
                        <li key={i} className="text-[11px] text-slate-400 flex gap-2 leading-snug"><span className="text-emerald-500/40 shrink-0">•</span><span>{pt}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {(summary.action_items?.length > 0 || summary.decisions?.length > 0) && (
                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <span className="text-[9px] font-bold text-amber-500/50 uppercase tracking-widest">Takeaways</span>
                    <ul className="space-y-1.5 pl-1">
                      {[...(summary.decisions || []), ...(summary.action_items || [])].map((v, i) => (
                        <li key={i} className="text-[11px] text-amber-100/60 flex gap-2 leading-snug"><span className="text-amber-500/30 shrink-0">✓</span><span>{v}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* LANE 2: ACTION FEED */}
        <div className="flex-[6] flex flex-col overflow-hidden bg-indigo-950/5">
          <div className="px-4 py-2 bg-indigo-950/20 border-b border-indigo-500/10 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-1.5">
              <Sparkles size={13} /> Copilot & Proxy
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
            {agentEntries.length === 0 && !aiDraft && suggestions.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-10 py-10">
                <Bot size={32} />
                <p className="text-[10px] uppercase font-bold tracking-widest mt-2">待机中</p>
              </div>
            )}
            {agentEntries.map(entry => (
              <div key={entry.id} className="relative group p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl hover:border-indigo-500/20 transition-all">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[9px] font-bold text-indigo-400/50 uppercase tracking-widest flex items-center gap-1"><Bot size={10}/> History</span>
                  <button onClick={() => sendManualTTS(entry.text)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-indigo-600/30 hover:bg-indigo-600 text-white rounded"><Volume2 size={11} /></button>
                </div>
                <p className="text-[13px] text-slate-300 leading-relaxed">{entry.text}</p>
              </div>
            ))}
            {(aiDraft || suggestions.length > 0) && (
              <div className="space-y-3 pt-3 border-t border-slate-800/60 relative">
                <div className="absolute -top-[9px] left-1/2 -translate-x-1/2 px-2 bg-slate-900/60 text-[9px] uppercase font-bold tracking-tighter text-emerald-400 border border-slate-800/60 rounded-full">New</div>
                {aiDraft && (
                  <div className="p-3 bg-gradient-to-br from-indigo-900/40 to-violet-900/20 border border-indigo-500/30 rounded-xl shadow-lg">
                    <span className="text-[9px] font-bold text-indigo-300 uppercase block mb-1.5 opacity-70">Proposed</span>
                    <p className="text-[14px] text-white leading-relaxed mb-3">{aiDraft}</p>
                    <button onClick={() => sendManualTTS(aiDraft)} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg">
                      <Volume2 size={14} /> 一键接管
                    </button>
                  </div>
                )}
                {suggestions.length > 0 && (
                  <div className="grid gap-2">
                    {suggestions.map((sug) => (
                      <div key={sug.id} onClick={() => sendSuggestion(sug.text)} className="group p-3 bg-slate-800/40 hover:bg-indigo-900/40 border border-slate-700/50 hover:border-indigo-500/50 rounded-xl transition-all cursor-pointer">
                        <p className="text-[12px] text-slate-200 leading-relaxed mb-2">{sug.text}</p>
                        <div className="flex justify-end"><span className="text-[9px] px-2.5 py-1 bg-slate-800 rounded-lg text-slate-400 font-bold uppercase group-hover:bg-indigo-600 group-hover:text-white transition-all flex items-center gap-1"><Volume2 size={11}/> 发送</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div ref={agentEndRef} />
          </div>
        </div>

        {/* Manual input */}
        <div className="px-3 py-2.5 border-t border-slate-800/40 bg-slate-950/60 shrink-0">
          <div className="flex gap-2">
            <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleManualSend()} placeholder="手动接管发言..." className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs placeholder-slate-700 focus:outline-none focus:border-indigo-500/50" />
            <button onClick={handleManualSend} disabled={!manualInput.trim()} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 rounded-lg transition-all shadow-lg active:scale-95"><Send size={14} /></button>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Sub-components ───

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1">
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
