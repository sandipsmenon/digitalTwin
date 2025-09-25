import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, addDoc, setDoc, deleteDoc, onSnapshot, collection, query } from 'firebase/firestore';

// Global variables provided by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Helper function to get the base path for collections
const getFirestoreBasePath = (userId) => `/artifacts/${appId}/users/${userId}`;

const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName] = useState('Ian Godding');
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ amount: '', category: 'Food', date: new Date().toISOString().substring(0, 10) });
  const [editingId, setEditingId] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState('Current You');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChartJsLoaded, setIsChartJsLoaded] = useState(false);

  // --- Firestore Initialization and Authentication ---
  useEffect(() => {
    try {
      if (!firebaseConfig.apiKey) {
        console.error("Firebase config is missing. Please check your environment.");
        return;
      }
      const app = initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      const dbInstance = getFirestore(app);
      setDb(dbInstance);
      setAuth(authInstance);

      onAuthStateChanged(authInstance, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(authInstance, initialAuthToken);
            } else {
              await signInAnonymously(authInstance);
            }
          } catch (error) {
            console.error("Authentication failed:", error);
          }
        }
      });
    } catch (error) {
      console.error("Failed to initialize Firebase:", error);
    }
  }, []);

  // --- Dynamic Script Loader for Chart.js ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js";
    script.async = true;
    script.onload = () => {
      setIsChartJsLoaded(true);
    };
    script.onerror = () => {
      console.error("Failed to load Chart.js script.");
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // --- Firestore Data Listener ---
  useEffect(() => {
    if (!db || !userId) return;

    const transactionCollectionPath = `${getFirestoreBasePath(userId)}/transactions`;
    const q = query(collection(db, transactionCollectionPath));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTransactions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTransactions(fetchedTransactions);
    }, (error) => {
      console.error("Error fetching transactions:", error);
    });

    return () => unsubscribe();
  }, [db, userId]);

  // --- Transaction Handlers ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!db || !userId) return;

    try {
      const transactionData = {
        amount: parseFloat(form.amount),
        category: form.category,
        date: form.date,
        timestamp: new Date().toISOString()
      };

      if (editingId) {
        await setDoc(doc(db, `${getFirestoreBasePath(userId)}/transactions`, editingId), transactionData);
        setEditingId(null);
      } else {
        await addDoc(collection(db, `${getFirestoreBasePath(userId)}/transactions`), transactionData);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 2000);
      }
      setForm({ amount: '', category: 'Food', date: new Date().toISOString().substring(0, 10) });
    } catch (error) {
      console.error("Error adding/updating transaction:", error);
    }
  };

  const handleEdit = (transaction) => {
    setForm({
      amount: transaction.amount.toString(),
      category: transaction.category,
      date: transaction.date
    });
    setEditingId(transaction.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!db || !userId) return;
    try {
      console.log(`Deleting transaction with ID: ${id}`);
      await deleteDoc(doc(db, `${getFirestoreBasePath(userId)}/transactions`, id));
    } catch (error) {
      console.error("Error deleting transaction:", error);
    }
  };

  // --- Data Analysis and Visualization ---
  const { spendingByCategories, totalSpending, riskLabel } = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
    const recentTransactions = transactions.filter(t => new Date(t.date) > thirtyDaysAgo);

    const categories = recentTransactions.reduce((acc, curr) => {
      acc[curr.category] = (acc[curr.category] || 0) + curr.amount;
      return acc;
    }, {});

    const total = Object.values(categories).reduce((sum, amount) => sum + amount, 0);

    const getRiskLabel = () => {
      if (total === 0) return 'No Spending Data';
      const funSpending = categories['Fun'] || 0;
      const gamblingSpending = categories['Gambling'] || 0;
      const highRiskSpending = categories['High-Risk Investments'] || 0;
      const wantsSpending = (categories['Wants'] || 0) + (categories['Subscriptions'] || 0) + (categories['Fun'] || 0);
      const gamblingPercentage = ((gamblingSpending + highRiskSpending) / total) * 100;
      const wantsPercentage = (wantsSpending / total) * 100;

      if (gamblingPercentage > 10) return 'Extremely High Risk';
      if (gamblingPercentage > 5 || wantsPercentage > 50) return 'High Risk';
      if (gamblingPercentage > 1 || wantsPercentage > 30) return 'Moderate Risk';
      return 'Low Risk';
    };

    return {
      spendingByCategories: categories,
      totalSpending: total,
      riskLabel: getRiskLabel()
    };
  }, [transactions]);

  const pieChartData = useMemo(() => {
    const categoryNames = Object.keys(spendingByCategories);
    const categoryAmounts = Object.values(spendingByCategories);
    return {
      labels: categoryNames,
      datasets: [
        {
          data: categoryAmounts,
          backgroundColor: categoryNames.map((_, i) => `hsl(${i * 30 + 200}, 50%, 50%)`),
          borderColor: '#1f2937',
          borderWidth: 2,
        },
      ],
    };
  }, [spendingByCategories]);

  // --- Chatbot Logic with LLM Integration ---
  const callGeminiAPI = async (userPrompt) => {
    const personas = {
      'Current You': "You are a financial analyst. Provide a response of no more than 3 lines. Provide a concise, single-paragraph summary of the key financial findings, using the user's transaction data to ground your advice.",
      'Good Twin': "You are an encouraging and positive financial coach. Provide a response of no more than 3 lines. Provide inspiring, actionable advice for building wealth and making smart financial choices. Avoid being overly strict or preachy.",
      'Evil Twin': "You are a mischievous financial advisor with a flair for the dramatic. You encourage risky, fun, and impulsive spending. Provide a response of no more than 3 lines. Your advice should be exciting and rebellious, but always include a disclaimer that it's 'not financial advice'."
    };

    const systemPrompt = personas[selectedPersona] || personas['Current You'];
    const formattedPrompt = `${userPrompt}. You can also use the user's spending data for context: ${JSON.stringify(spendingByCategories)} and their total spending: £${totalSpending.toFixed(2)}.`;

    const payload = {
      contents: [{ parts: [{ text: formattedPrompt }] }],
      tools: [{ "google_search": {} }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }
      const result = await response.json();
      const candidate = result.candidates?.[0];

      if (candidate && candidate.content?.parts?.[0]?.text) {
        const text = candidate.content.parts[0].text;
        const groundingMetadata = candidate.groundingMetadata;
        let sources = [];
        if (groundingMetadata && groundingMetadata.groundingAttributions) {
            sources = groundingMetadata.groundingAttributions
                .map(attribution => ({ uri: attribution.web?.uri, title: attribution.web?.title }))
                .filter(source => source.uri && source.title);
        }
        return { text, sources };
      }
      return { text: "I'm sorry, I couldn't generate a response at this time." };
    } catch (error) {
      console.error("Gemini API call error:", error);
      return { text: "There was an error connecting to the financial twin. Please try again." };
    }
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim()) return;

    const userMessage = { role: 'user', personaName: 'You', text: chatInput };
    setChatHistory(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    const botResponse = await callGeminiAPI(chatInput);
    const botMessage = { role: 'bot', personaName: selectedPersona, text: botResponse.text, sources: botResponse.sources };
    setChatHistory(prev => [...prev, botMessage]);
    setIsChatLoading(false);
  };

  const handleDefaultQuestionClick = (question) => {
    setChatInput(question);
    handleChatSubmit();
  };

  // --- UI Components ---
  const Confetti = () => (
    <div className={`absolute inset-0 z-50 pointer-events-none transition-opacity duration-1000 ${showConfetti ? 'opacity-100' : 'opacity-0'}`}>
      <svg width="100%" height="100%" className="confetti-svg absolute inset-0">
        {[...Array(100)].map((_, i) => {
          const x = Math.random() * 100;
          const y = Math.random() * 100;
          const size = Math.random() * 8 + 4;
          const color = `hsl(${Math.random() * 360}, 100%, 80%)`;
          const duration = Math.random() * 1 + 1.5;
          const delay = Math.random() * 0.5;
          const opacity = Math.random() * 0.5 + 0.5;
          return (
            <circle
              key={i}
              cx={`${x}%`} cy={`${y}%`} r={size}
              fill={color} opacity={opacity}
              style={{
                animation: `confetti-fall ${duration}s ease-in-out forwards`,
                animationDelay: `${delay}s`,
              }}
            />
          );
        })}
      </svg>
    </div>
  );

  const FinancialRiskAvatar = ({ risk }) => {
    let auraColor = 'from-gray-700 to-gray-900';
    let labelColor = 'text-gray-400';
    let twinLabel = 'Digital Twin';
    let avatarColor = 'bg-gray-700';
    let textColor = 'text-gray-400';

    switch (risk) {
      case 'Low Risk':
        auraColor = 'from-blue-600 to-cyan-600';
        labelColor = 'text-cyan-400';
        twinLabel = 'Your Good Twin';
        avatarColor = 'bg-gray-700';
        textColor = 'text-gray-200';
        break;
      case 'Moderate Risk':
        auraColor = 'from-yellow-500 to-orange-500';
        labelColor = 'text-yellow-400';
        twinLabel = 'Your Balanced Twin';
        avatarColor = 'bg-gray-700';
        textColor = 'text-gray-200';
        break;
      case 'High Risk':
        auraColor = 'from-red-600 to-red-800';
        labelColor = 'text-red-400';
        twinLabel = 'Your Risky Twin';
        avatarColor = 'bg-gray-700';
        textColor = 'text-gray-200';
        break;
      case 'Extremely High Risk':
        auraColor = 'from-red-900 to-gray-900';
        labelColor = 'text-red-400';
        twinLabel = 'Your Evil Twin';
        avatarColor = 'bg-gray-700';
        textColor = 'text-gray-200';
        break;
      default:
        // Default colors are set at the top
    }

    const pulseStyle = {
      animation: risk === 'Extremely High Risk' ? 'pulse-custom 1.5s infinite' : 'none',
    };

    return (
      <div className="relative flex flex-col items-center">
        <div className={`relative w-36 h-36 rounded-full flex items-center justify-center p-1 bg-gradient-to-br ${auraColor}`}
          style={pulseStyle}>
          <div className={`w-full h-full ${avatarColor} rounded-full flex items-center justify-center`}>
            <span className={`text-6xl ${textColor}`}>👤</span>
          </div>
        </div>
        <div className={`mt-4 px-4 py-2 rounded-full font-bold text-sm ${labelColor} bg-slate-800/80 backdrop-blur-sm shadow-lg`}>
          <p>{twinLabel}</p>
          <p className="text-xs">{risk}</p>
        </div>
      </div>
    );
  };

  const PieChart = ({ data, isChartJsLoaded }) => {
    const chartRef = useRef(null);
    const chartInstanceRef = useRef(null);

    useEffect(() => {
      if (chartRef.current && isChartJsLoaded) {
        if (chartInstanceRef.current) {
          chartInstanceRef.current.data = data;
          chartInstanceRef.current.update();
        } else {
          const ctx = chartRef.current.getContext('2d');
          chartInstanceRef.current = new window.Chart(ctx, {
            type: 'pie',
            data: data,
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'top',
                  labels: {
                    font: { family: 'Inter, sans-serif' },
                    color: '#9ca3af'
                  }
                }
              }
            }
          });
        }
      }

      return () => {
        if (chartInstanceRef.current) {
          chartInstanceRef.current.destroy();
          chartInstanceRef.current = null;
        }
      };
    }, [data, isChartJsLoaded]);

    return (
      <div className="h-64 md:h-80 flex items-center justify-center">
        {isChartJsLoaded ? (
          <canvas ref={chartRef} id="pie-chart" className="w-full h-full"></canvas>
        ) : (
          <p className="text-gray-500">Loading chart...</p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-gray-200 p-4 font-sans relative">
      {/* Tailwind should be loaded via your HTML template (public/index.html) for a cleaner setup. */}

      <div className="max-w-4xl mx-auto space-y-8 pb-16">
        <header className="text-center pt-8 pb-4">
          <h1 className="text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400 tracking-tight">
            Digital Twin
          </h1>
          <p className="mt-2 text-lg text-gray-400">Welcome, {userName}.</p>
          {userId && (
            <div className="mt-4 text-sm text-gray-500 break-all">
              User ID: <span className="font-mono text-gray-400">{userId}</span>
            </div>
          )}
        </header>

        {/* Confetti animation */}
        {showConfetti && <Confetti />}

        {/* --- Spending Tracker --- */}
        <section className="bg-slate-800/60 backdrop-blur-md rounded-3xl p-6 shadow-xl border border-slate-700">
          <h2 className="text-3xl font-bold text-center mb-6 text-gray-100">Log a Transaction</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="amount" className="block text-sm font-medium text-gray-400">Amount (£)</label>
                <input
                  type="number"
                  name="amount"
                  id="amount"
                  value={form.amount}
                  onChange={handleInputChange}
                  required
                  className="mt-1 block w-full rounded-xl border-slate-600 shadow-sm bg-slate-700/50 text-gray-100 transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-400">Category</label>
                <select
                  name="category"
                  id="category"
                  value={form.category}
                  onChange={handleInputChange}
                  required
                  className="mt-1 block w-full rounded-xl border-slate-600 shadow-sm bg-slate-700/50 text-gray-100 transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option>Food</option>
                  <option>Subscriptions</option>
                  <option>Transport</option>
                  <option>Fun</option>
                  <option>Health</option>
                  <option>Needs</option>
                  <option>Wants</option>
                  <option>Gambling</option>
                  <option>High-Risk Investments</option>
                  <option>Investment</option>
                  <option>Pension</option>
                  <option>Education</option>
                  <option>Savings</option>
                  <option>Travel</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="date" className="block text-sm font-medium text-gray-400">Date</label>
                <input
                  type="date"
                  name="date"
                  id="date"
                  value={form.date}
                  onChange={handleInputChange}
                  required
                  className="mt-1 block w-full rounded-xl border-slate-600 shadow-sm bg-slate-700/50 text-gray-100 transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-3 px-6 rounded-2xl text-white font-semibold shadow-lg transition-all transform hover:scale-105 active:scale-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-gradient-to-r from-blue-500 to-cyan-500"
            >
              {editingId ? 'Update Transaction' : 'Add Transaction'}
            </button>
          </form>
        </section>

        {/* --- Data Visualization & Risk Assessment --- */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-slate-800/60 backdrop-blur-md rounded-3xl p-6 shadow-xl border border-slate-700 flex flex-col items-center justify-center">
            <h2 className="text-3xl font-bold mb-4 text-center text-gray-100">Spending Breakdown</h2>
            <div className="w-full max-w-sm h-64 md:h-80">
              <PieChart data={pieChartData} isChartJsLoaded={isChartJsLoaded} />
            </div>
          </div>
          <div className="bg-slate-800/60 backdrop-blur-md rounded-3xl p-6 shadow-xl border border-slate-700 flex flex-col items-center justify-center">
            <h2 className="text-3xl font-bold mb-4 text-center text-gray-100">Your Twin's Vibe</h2>
            <FinancialRiskAvatar risk={riskLabel} />
            <div className="mt-6 text-center text-sm text-gray-400">
              <p>Your current financial vibe is <strong className="text-white">{riskLabel}</strong>.</p>
              <p>This is based on your spending habits over the last 30 days.</p>
            </div>
          </div>
        </section>

        {/* --- Transaction History --- */}
        <section className="bg-slate-800/60 backdrop-blur-md rounded-3xl p-6 shadow-xl border border-slate-700">
          <h2 className="text-3xl font-bold text-center mb-6 text-gray-100">Transaction History</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-700">
              <thead className="bg-slate-700/70">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Category</th>
                  <th className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="bg-slate-800/70 divide-y divide-slate-700">
                {[...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">{tx.date}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">£{(tx.amount ?? 0).toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">{tx.category}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEdit(tx)}
                        className="text-blue-400 hover:text-cyan-400 mr-4"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(tx.id)}
                        className="text-red-400 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* --- Chatbot Section --- */}
        <section className="bg-slate-800/60 backdrop-blur-md rounded-3xl p-6 shadow-xl border border-slate-700">
          <h2 className="text-3xl font-bold text-center mb-6 text-gray-100">Talk to Your Twin</h2>
          <div className="flex justify-center mb-6 space-x-2">
            {['Current You', 'Good Twin', 'Evil Twin'].map(persona => (
              <button
                key={persona}
                onClick={() => setSelectedPersona(persona)}
                className={`py-2 px-4 rounded-full font-semibold transition-all shadow-lg ${selectedPersona === persona ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white transform scale-105' : 'bg-slate-700 text-gray-200 hover:bg-slate-600'}`}
              >
                {persona}
              </button>
            ))}
          </div>
          
          <div className="mb-4 flex flex-wrap gap-2 justify-center">
            {['Gambling problem?', 'Investments?', 'How\'s my lifestyle?', 'How to save more?'].map((question) => (
              <button
                key={question}
                onClick={() => handleDefaultQuestionClick(question)}
                className="py-1 px-3 rounded-full text-xs font-medium bg-slate-700 text-gray-400 hover:bg-slate-600 transition-colors"
              >
                {question}
              </button>
            ))}
          </div>

          <div className="h-96 overflow-y-auto p-4 border rounded-2xl mb-4 bg-slate-900/60 border-slate-700">
            {chatHistory.map((msg, index) => (
              <div key={index} className={`mb-2 p-3 rounded-xl max-w-[80%] ${msg.role === 'user' ? 'bg-slate-700 self-end ml-auto' : 'bg-slate-600 self-start mr-auto'}`}>
                <p className="font-bold text-sm mb-1">{msg.personaName}</p>
                <p>{msg.text}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 text-xs text-gray-400">
                    <p>Sources:</p>
                    <ul>
                      {msg.sources.map((source, i) => (
                        <li key={i}>
                          <a href={source.uri} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-200 transition-colors">
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-center mt-4">
                <div className="w-6 h-6 rounded-full border-2 border-blue-400 border-t-blue-600 animate-spin"></div>
              </div>
            )}
          </div>
          <div className="flex space-x-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
              placeholder={`Ask your ${selectedPersona} anything...`}
              className="flex-1 rounded-2xl border-slate-600 shadow-sm bg-slate-700/50 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleChatSubmit}
              className="py-2 px-6 rounded-2xl text-white font-semibold shadow-lg transition-all transform hover:scale-105 active:scale-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-gradient-to-r from-blue-500 to-cyan-500"
            >
              Send
            </button>
          </div>
        </section>

      </div>
      <style>
        {`
        body {
          font-family: 'Inter', sans-serif;
        }

        @keyframes pulse-custom {
          0%, 100% { box-shadow: 0 0 50px 10px rgba(239, 68, 68, 0.5); }
          50% { box-shadow: 0 0 80px 20px rgba(239, 68, 68, 0.8); }
        }

        @keyframes confetti-fall {
          0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }

        .confetti-svg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        .confetti-svg circle {
          /* Use forwards so each piece falls once */
          animation: confetti-fall 2s ease-in-out forwards;
        }
        `}
      </style>
    </div>
  );
};

export default App;
