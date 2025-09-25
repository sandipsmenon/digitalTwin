import React, { useEffect, useState, useMemo, useRef } from 'react';

// Single-file Digital Twin React app
// - Uses Firebase for persistence/auth if window.__firebase_config is set
// - Falls back to localStorage for transactions and auth otherwise
// - Dynamically loads Tailwind and Chart.js
// - Chatbot uses Gemini API if key is provided, otherwise returns mock responses

const GEMINI_API_KEY = "AIzaSyC6sm0U4LEfc7YRofjkEbQMNuL8P7IAO0s"; // Inserted per user request. Consider using env vars for security.

const defaultCategories = [
  'Food','Subscriptions','Transport','Fun','Health','Needs','Wants','Gambling','High-Risk Investments','Investment','Pension','Education','Savings','Travel'
];

const getLocalKey = (userId) => `digital-twin:${userId}:transactions`;

const loadScript = (src, attrs = {}) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement('script');
  s.src = src;
  Object.entries(attrs).forEach(([k,v]) => s.setAttribute(k, v));
  s.onload = () => res();
  s.onerror = (e) => rej(e);
  document.head.appendChild(s);
});

const DigitalTwin = () => {
  const [userId, setUserId] = useState('local-user');
  const [firebaseClient, setFirebaseClient] = useState(null); // { db, auth }
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ amount: '', category: 'Food', date: new Date().toISOString().slice(0,10) });
  const [editingId, setEditingId] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState('Current You');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChartLoaded, setIsChartLoaded] = useState(false);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const chatContainerRef = useRef(null);

  // Load Tailwind + font for quick styling
  useEffect(() => {
    // Use the official Tailwind CDN script which provides the newer utility syntax (e.g. bg-slate-700/60)
    const tailScript = document.createElement('script');
    tailScript.src = 'https://cdn.tailwindcss.com';
    document.head.appendChild(tailScript);
    const f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap';
    document.head.appendChild(f);
    document.documentElement.style.scrollBehavior = 'smooth';

    // Force a solid black background at the document level to avoid transparency issues
    document.documentElement.style.backgroundColor = '#000';
    document.body.style.backgroundColor = '#000';
    document.body.style.backgroundImage = 'none';
  }, []);

  // Load Chart.js dynamically
  useEffect(() => {
    loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js')
      .then(() => setIsChartLoaded(true))
      .catch((e) => console.warn('Chart.js failed to load', e));
  }, []);

  // Initialize Firebase if config is provided in window.__firebase_config
  useEffect(() => {
    const tryInitFirebase = async () => {
      const cfg = typeof window !== 'undefined' ? window.__firebase_config : null;
      const token = typeof window !== 'undefined' ? window.__initial_auth_token : null;
      if (!cfg) {
        // local-only mode
        const uid = localStorage.getItem('digital-twin:local-user-id') || `local-${Math.random().toString(36).slice(2,9)}`;
        localStorage.setItem('digital-twin:local-user-id', uid);
        setUserId(uid);
        return;
      }

      try {
        // Load Firebase compat scripts (global namespace) to avoid bundler import issues
        await loadScript('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/9.22.1/firebase-auth-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore-compat.js');

        const fb = window.firebase;
        if (!fb) throw new Error('Firebase global not found');

        // Initialize app (if not already)
        try {
          fb.app();
        } catch (e) {
          fb.initializeApp(cfg);
        }

        const auth = fb.auth();
        const db = fb.firestore();
        setFirebaseClient({ auth, db });

        auth.onAuthStateChanged(async (user) => {
          if (user) setUserId(user.uid);
          else {
            try {
              if (token) await auth.signInWithCustomToken(token);
              else await auth.signInAnonymously();
            } catch (e) {
              console.warn('Firebase auth failed, using local mode', e);
              const uid = localStorage.getItem('digital-twin:local-user-id') || `local-${Math.random().toString(36).slice(2,9)}`;
              localStorage.setItem('digital-twin:local-user-id', uid);
              setUserId(uid);
            }
          }
        });

      } catch (e) {
        console.warn('Firebase init failed', e);
        const uid = localStorage.getItem('digital-twin:local-user-id') || `local-${Math.random().toString(36).slice(2,9)}`;
        localStorage.setItem('digital-twin:local-user-id', uid);
        setUserId(uid);
      }
    };
    tryInitFirebase();
  }, []);

  // Load transactions from Firestore (if available) or localStorage
  useEffect(() => {
    const loadLocal = () => {
      if (!userId) return;
      const raw = localStorage.getItem(getLocalKey(userId));
      if (raw) {
        try { setTransactions(JSON.parse(raw)); } catch (e) { setTransactions([]); }
      }
    };

    if (firebaseClient && firebaseClient.db && userId) {
      try {
        const collRef = firebaseClient.db.collection(`artifacts/digital-twin/users/${userId}/transactions`);
        const unsubscribe = collRef.onSnapshot((snap) => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setTransactions(docs);
        }, (err) => { console.warn('Firestore snapshot error', err); loadLocal(); });
        return () => unsubscribe();
      } catch (e) { console.warn(e); loadLocal(); }
    } else {
      loadLocal();
    }
  }, [firebaseClient, userId]);

  // Persist local transactions if not using Firestore
  useEffect(() => {
    if (!firebaseClient || !firebaseClient.db) {
      if (userId) localStorage.setItem(getLocalKey(userId), JSON.stringify(transactions));
    }
  }, [transactions, firebaseClient, userId]);

  // Update pie chart when transactions or chart load changes
  useEffect(() => {
    if (!isChartLoaded || !chartRef.current) return;
    const Chart = window.Chart;
    const pieData = (() => {
      const categories = {};
      transactions.forEach(t => {
        const a = Number(t.amount || 0);
        categories[t.category] = (categories[t.category] || 0) + a;
      });
      return {
        labels: Object.keys(categories),
        datasets: [{ data: Object.values(categories), backgroundColor: Object.keys(categories).map((_,i) => `hsl(${i*40} 80% 60%)`) }]
      };
    })();

    if (chartInstance.current) {
      chartInstance.current.data = pieData;
      chartInstance.current.update();
    } else {
      chartInstance.current = new Chart(chartRef.current.getContext('2d'), { type:'pie', data: pieData, options:{ responsive:true } });
    }
  }, [isChartLoaded, transactions]);

  // Risk calculation (last 30 days)
  const riskLabel = useMemo(() => {
    const now = new Date();
    const thirtyAgo = new Date(now.getTime() - 1000*60*60*24*30);
    const recent = transactions.filter(t => new Date(t.date) > thirtyAgo);
    const total = recent.reduce((s, t) => s + Number(t.amount || 0), 0);
    const gambling = recent.filter(t => t.category === 'Gambling').reduce((s,t)=>s+Number(t.amount||0),0);
    const highRisk = recent.filter(t => t.category === 'High-Risk Investments').reduce((s,t)=>s+Number(t.amount||0),0);
    const pct = total === 0 ? 0 : ((gambling + highRisk) / total) * 100;
    if (pct > 10) return 'Extremely High Risk';
    if (pct > 5) return 'High Risk';
    if (pct > 1) return 'Moderate Risk';
    return 'Low Risk';
  }, [transactions]);

  // Persistence helpers
  const saveToBackend = async (tx) => {
    if (firebaseClient && firebaseClient.db) {
      try {
        const coll = firebaseClient.db.collection(`artifacts/digital-twin/users/${userId}/transactions`);
        await coll.add(tx);
        return;
      } catch (e) { console.warn('Firestore save failed', e); }
    }
    // fallback: local state
    setTransactions(prev => [{ ...tx, id: `local-${Date.now()}` }, ...prev]);
  };

  const updateBackend = async (id, tx) => {
    if (firebaseClient && firebaseClient.db) {
      try {
        const docRef = firebaseClient.db.collection(`artifacts/digital-twin/users/${userId}/transactions`).doc(id);
        await docRef.set(tx);
        return;
      } catch (e) { console.warn('Firestore update failed', e); }
    }
    setTransactions(prev => prev.map(p => p.id === id ? { ...p, ...tx } : p));
  };

  const deleteFromBackend = async (id) => {
    if (firebaseClient && firebaseClient.db) {
      try {
        const docRef = firebaseClient.db.collection(`artifacts/digital-twin/users/${userId}/transactions`).doc(id);
        await docRef.delete();
        return;
      } catch (e) { console.warn('Firestore delete failed', e); }
    }
    setTransactions(prev => prev.filter(p => p.id !== id));
  };

  // Handlers
  const handleInput = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault();
    const payload = { amount: Number(form.amount || 0), category: form.category, date: form.date || new Date().toISOString().slice(0,10), timestamp: new Date().toISOString() };
    if (editingId) {
      await updateBackend(editingId, payload);
      setEditingId(null);
    } else {
      await saveToBackend(payload);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1800);
    }
    setForm({ amount: '', category: 'Food', date: new Date().toISOString().slice(0,10) });
  };

  const handleEdit = (tx) => {
    setForm({ amount: String(tx.amount || ''), category: tx.category, date: tx.date });
    setEditingId(tx.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this transaction?')) return;
    await deleteFromBackend(id);
  };

  // Chatbot logic (call Gemini if key provided)
  const personas = {
    'Current You': "You are a financial analyst. Provide concise, practical observations grounded in the user's spending data.",
    'Good Twin': "You are an encouraging financial coach. Provide gentle, actionable tips to save and grow wealth.",
    'Evil Twin': "You are a mischievous advisor encouraging risky fun. Always include a disclaimer: not financial advice."
  };

  // Helper to limit text to a maximum number of lines (newline or sentence-based)
  const shortenToMaxLines = (text, maxLines = 3) => {
    if (!text) return text;
    // Normalize whitespace
    const normalized = String(text).trim().replace(/\r\n/g, '\n');
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= maxLines) return lines.slice(0, maxLines).join('\n');

    // If fewer lines but very long, split into sentences and aggregate into lines
    const sentences = normalized.split(/(?<=[.!?])\s+/);
    const resultLines = [];
    let current = '';
    for (const s of sentences) {
      if (!current) current = s.trim();
      else current += ' ' + s.trim();
      // If current is long enough or ends with punctuation, push as a line
      if (current.length > 120 || /[.!?]$/.test(current)) {
        resultLines.push(current);
        current = '';
      }
      if (resultLines.length >= maxLines) break;
    }
    if (resultLines.length < maxLines && current) resultLines.push(current);
    return resultLines.slice(0, maxLines).join('\n');
  };

  const callGeminiAPI = async (userPrompt) => {
    if (!GEMINI_API_KEY) {
      const mock = `(No Gemini API key) Mock reply for: ${userPrompt}`;
      return { text: shortenToMaxLines(mock, 3), sources: [] };
    }

    const systemPrompt = personas[selectedPersona] || personas['Current You'];
    const payload = { contents:[{ parts:[{ text: userPrompt }] }], systemInstruction:{ parts:[{ text: systemPrompt }] }, tools:[{ google_search:{} }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    try {
      const res = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('LLM call failed');
      const json = await res.json();
      const cand = json.candidates?.[0];
      const text = cand?.content?.parts?.[0]?.text || 'No response';
      const sources = cand?.groundingMetadata?.groundingAttributions?.map(a => ({ title: a.web?.title, uri: a.web?.uri })).filter(Boolean) || [];
      return { text: shortenToMaxLines(text, 3), sources };
    } catch (e) {
      console.warn(e);
      return { text: shortenToMaxLines('Error contacting Gemini. Please try again later.', 3), sources: [] };
    }
  };

  const sendChat = async (question) => {
    if (!question || !String(question).trim() || isChatLoading) return;
    const userMsg = { role: 'user', personaName: 'You', text: question };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const bot = await callGeminiAPI(question);
      setChatHistory(prev => [...prev, { role: 'bot', personaName: selectedPersona, text: bot.text, sources: bot.sources }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'bot', personaName: selectedPersona, text: 'Error fetching response. Please try again.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Auto-scroll chat container when history updates
  useEffect(() => {
    if (chatContainerRef && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const presetQuestions = ['Gambling problem?', 'Investments?', "How's my lifestyle?", 'How to save more?'];

  // Confetti component
  const Confetti = () => {
    const pieces = Array.from({length:60}).map((_,i)=>({ id:i, left: Math.random()*100, delay: Math.random()*0.6, size: Math.random()*8+6, color:`hsl(${Math.random()*360} 90% 65%)` }));
    return (
      <div className={`pointer-events-none fixed inset-0 z-50 ${showConfetti ? 'opacity-100' : 'opacity-0'} transition-opacity`} aria-hidden>
        <div className="absolute inset-0 overflow-hidden">
          {pieces.map(p => (
            <div key={p.id} style={{ left:`${p.left}%`, top:'-10%', position:'absolute', animation:`fall 1.8s ${p.delay}s linear forwards` }}>
              <div style={{ width:p.size, height:p.size, background:p.color, borderRadius:6, opacity:0.95 }} />
            </div>
          ))}
        </div>
        <style>{`@keyframes fall { to { transform: translateY(120vh) rotate(540deg); opacity: 0; } }`}</style>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-gray-100 p-4" style={{ fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#000' }}>
      <div className="max-w-5xl mx-auto">
        <header className="text-center py-8">
          <h1 className="text-4xl md:text-6xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">Digital Twin</h1>
          <p className="mt-2 text-gray-300">Personal financial dashboard • £ (GBP)</p>
        </header>

        {showConfetti && <Confetti />}

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="lg:col-span-2 space-y-6">
            <div className="bg-slate-800 rounded-2xl p-6 shadow">
              <h2 className="text-2xl font-semibold mb-4">Log a Transaction</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input name="amount" value={form.amount} onChange={handleInput} placeholder="Amount (£)" type="number" className="p-2 rounded-lg bg-slate-800 text-white" required />
                  <select name="category" value={form.category} onChange={handleInput} className="p-2 rounded-lg bg-slate-800 text-white">
                    {defaultCategories.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input name="date" type="date" value={form.date} onChange={handleInput} className="p-2 rounded-lg bg-slate-800 text-white" />
                </div>
                <div className="flex gap-3">
                  <button type="submit" className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 font-semibold">{editingId ? 'Update' : 'Add Transaction'}</button>
                  {editingId && <button type="button" onClick={() => { setEditingId(null); setForm({ amount:'', category:'Food', date:new Date().toISOString().slice(0,10) }); }} className="px-4 py-2 rounded-lg bg-slate-700">Cancel</button>}
                </div>
              </form>
            </div>

            <div className="bg-slate-800 rounded-2xl p-6 shadow">
              <h2 className="text-2xl font-semibold mb-4">Transaction History</h2>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-400 sticky top-0 bg-slate-800/80">
                    <tr><th className="p-2">Date</th><th className="p-2">Amount</th><th className="p-2">Category</th><th className="p-2">Actions</th></tr>
                  </thead>
                  <tbody>
                    {[...transactions].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(tx => (
                      <tr key={tx.id} className="border-t border-slate-700">
                        <td className="p-2 align-top">{tx.date}</td>
                        <td className="p-2 align-top">£{Number(tx.amount||0).toFixed(2)}</td>
                        <td className="p-2 align-top">{tx.category}</td>
                        <td className="p-2 align-top">
                          <button onClick={()=>handleEdit(tx)} className="text-cyan-300 mr-2">Edit</button>
                          <button onClick={()=>handleDelete(tx.id)} className="text-red-400">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </section>

          <aside className="space-y-6">
            <div className="bg-slate-800 rounded-2xl p-6 shadow text-center">
              <h3 className="text-lg font-semibold">Your Twin's Vibe</h3>
              <div className="my-4 flex flex-col items-center">
                <div className={`w-32 h-32 rounded-full flex items-center justify-center mb-3 ${riskLabel === 'Extremely High Risk' ? 'animate-pulse' : ''}`} style={{ background: riskLabel === 'Low Risk' ? 'linear-gradient(135deg,#60a5fa,#06b6d4)' : riskLabel === 'Moderate Risk' ? 'linear-gradient(135deg,#f59e0b,#fb923c)' : 'linear-gradient(135deg,#ef4444,#b91c1c)' }}>
                  <div className="w-28 h-28 bg-slate-900 rounded-full flex items-center justify-center text-3xl">
                    {riskLabel === 'Extremely High Risk' ? '😈' : riskLabel === 'High Risk' ? '😵' : riskLabel === 'Moderate Risk' ? '😐' : '🙂'}
                  </div>
                </div>
                <div className="text-sm text-gray-300"><strong className="text-white">{riskLabel}</strong></div>
                <div className="mt-2 text-xs text-gray-400">Based on last 30 days</div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-2xl p-6 shadow">
              <h3 className="text-lg font-semibold mb-3">Spending Breakdown</h3>
              <div className="w-full h-48">
                {isChartLoaded ? <canvas ref={chartRef} /> : <div className="text-gray-400">Loading chart...</div>}
              </div>
            </div>

            <div className="bg-slate-800 rounded-2xl p-6 shadow">
              <h3 className="text-lg font-semibold mb-3">Talk to Your Twin</h3>
              <div className="flex gap-2 mb-3">
                {Object.keys(personas).map(p => (
                  <button key={p} onClick={()=>setSelectedPersona(p)} className={`px-3 py-1 rounded-full ${selectedPersona===p? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white':'bg-slate-700 text-gray-200'}`}>{p}</button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                {presetQuestions.map(q => (
                  <button key={q} onClick={()=>sendChat(q)} className="text-xs px-2 py-1 rounded-full bg-slate-700 text-gray-300">{q}</button>
                ))}
              </div>

              <div className="h-64 md:h-80 overflow-auto mb-3 p-2 bg-slate-900 rounded">
                <div ref={chatContainerRef} className="space-y-3">
                  {chatHistory.map((m,i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[80%]">
                        <div className="text-xs text-gray-400 mb-1">{m.personaName}</div>
                        <div className={`px-3 py-2 rounded-lg break-words whitespace-pre-wrap ${m.role === 'user' ? 'bg-slate-700 text-white rounded-br-md' : 'bg-slate-600 text-white rounded-bl-md'}`}>
                          {m.text}
                        </div>
                        {m.sources && m.sources.length > 0 && (
                          <div className="text-xs text-gray-400 mt-1">
                            Sources:
                            <ul>
                              {m.sources.map((s, idx) => (
                                <li key={idx}><a href={s.uri} target="_blank" rel="noreferrer" className="underline ml-1">{s.title || s.uri}</a></li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="max-w-[80%]">
                        <div className="text-xs text-gray-400 mb-1">{selectedPersona}</div>
                        <div className="px-3 py-2 rounded-lg bg-slate-600 text-white italic opacity-90">Thinking<span className="ml-2">⠂⠂⠂</span></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <input disabled={isChatLoading} value={chatInput} onChange={(e)=>setChatInput(e.target.value)} onKeyDown={(e)=>e.key==='Enter' && sendChat(chatInput)} className={`flex-1 p-2 rounded ${isChatLoading ? 'bg-slate-700/50 text-gray-400' : 'bg-slate-800 text-white'}`} placeholder={`Ask your ${selectedPersona}...`} />
                <button disabled={isChatLoading} onClick={()=>sendChat(chatInput)} className={`px-3 py-2 rounded ${isChatLoading ? 'bg-slate-700/50 text-gray-400' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`}>
                  {isChatLoading ? 'Thinking...' : 'Send'}
                </button>
              </div>
            </div>
          </aside>

        </main>

        <footer className="text-center text-xs text-gray-500 mt-8">Built with ❤️ • Data persisted to Firebase when configured, otherwise stored locally in your browser.</footer>
      </div>
    </div>
  );
};

export default DigitalTwin;
