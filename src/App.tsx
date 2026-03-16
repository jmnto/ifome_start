/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Upload, Utensils, Info, Loader2, Camera, X, ChefHat, Flame, Scale, User, Save, ChevronRight, History, Trash2, CheckCircle2, MessageSquare, Send, Sparkles, Volume2, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini AI
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface Ingredient {
  name: string;
  quantity: string;
  calories: number;
}

interface AnalysisResult {
  dishName: string;
  ingredients: Ingredient[];
  totalCalories: number;
  description: string;
}

interface UserProfile {
  name: string;
  age: number;
  weight: number;
  height: number;
  calorieGoal: number;
}

type MealType = 'Café da manhã' | 'Lanche da manhã' | 'Almoço' | 'Lanche da tarde' | 'Jantar' | 'Lanche da noite';

interface MealRecord {
  id: string;
  type: MealType;
  dishName: string;
  calories: number;
  timestamp: number;
  image?: string;
}

const MEAL_TYPES: MealType[] = [
  'Café da manhã',
  'Lanche da manhã',
  'Almoço',
  'Lanche da tarde',
  'Jantar',
  'Lanche da noite'
];

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMealType, setSelectedMealType] = useState<MealType>('Café da manhã');
  const [dailyMeals, setDailyMeals] = useState<MealRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [groundingSources, setGroundingSources] = useState<{title: string, uri: string}[]>([]);
  
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [playingAudioId, setPlayingAudioId] = useState<number | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const handlePlaySpeech = async (text: string, idx: number) => {
    if (playingAudioId === idx) {
      if (audioSourceRef.current) {
        audioSourceRef.current.stop();
        audioSourceRef.current = null;
      }
      setPlayingAudioId(null);
      return;
    }

    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
    }

    setPlayingAudioId(idx);

    try {
      const response = await safeGenerateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        
        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        let audioBuffer: AudioBuffer;
        if (bytes.length > 4 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70) {
          audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
        } else {
          const int16Array = new Int16Array(bytes.buffer);
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
          }
          audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
          audioBuffer.getChannelData(0).set(float32Array);
        }
        
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        
        source.onended = () => {
          setPlayingAudioId(null);
          if (audioSourceRef.current === source) {
            audioSourceRef.current = null;
          }
        };
        
        audioSourceRef.current = source;
        source.start();
      } else {
        setPlayingAudioId(null);
      }
    } catch (err) {
      console.error("Error generating speech:", err);
      setPlayingAudioId(null);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const safeGenerateContent = async (params: any, retries = 2, delay = 2000) => {
    try {
      return await genAI.models.generateContent(params);
    } catch (err: any) {
      const errorText = err.message || "";
      const isQuotaError = errorText.includes('429') || errorText.includes('RESOURCE_EXHAUSTED') || err.status === 429;
      
      if (isQuotaError && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return safeGenerateContent(params, retries - 1, delay * 2);
      }
      
      if (isQuotaError) {
        throw new Error("Limite de uso do Gemini atingido. O limite de cota gratuita será resetado em breve (geralmente em alguns minutos ou no próximo dia). Por favor, aguarde um momento antes de tentar novamente.");
      }
      
      throw err;
    }
  };

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    weight: '',
    height: '',
    calorieGoal: ''
  });

  useEffect(() => {
    const savedProfile = localStorage.getItem('ifome_profile');
    if (savedProfile) {
      setProfile(JSON.parse(savedProfile));
    } else {
      setShowRegistration(true);
    }

    const savedMeals = localStorage.getItem('ifome_daily_meals');
    if (savedMeals) {
      const parsedMeals = JSON.parse(savedMeals);
      // Filter for today only
      const today = new Date().toDateString();
      const todayMeals = parsedMeals.filter((m: MealRecord) => new Date(m.timestamp).toDateString() === today);
      setDailyMeals(todayMeals);
    }
  }, []);

  const handleRegistrationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newProfile: UserProfile = {
      name: formData.name,
      age: Number(formData.age),
      weight: Number(formData.weight),
      height: Number(formData.height),
      calorieGoal: Number(formData.calorieGoal)
    };
    localStorage.setItem('ifome_profile', JSON.stringify(newProfile));
    setProfile(newProfile);
    setShowRegistration(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setResult(null);
        setError(null);
        setSaveSuccess(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async () => {
    if (!image) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const base64Data = image.split(',')[1];
      
      const response = await safeGenerateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Data,
                },
              },
              {
                text: "Analise esta imagem de comida e identifique o prato, os ingredientes e as quantidades estimadas. Use a pesquisa do Google para encontrar os valores calóricos mais precisos e atualizados para cada ingrediente e quantidade identificada. Retorne os dados em formato JSON.",
              },
            ],
          },
        ],
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              dishName: { type: Type.STRING, description: "Nome do prato identificado" },
              description: { type: Type.STRING, description: "Breve descrição do prato" },
              totalCalories: { type: Type.NUMBER, description: "Total de calorias estimadas" },
              ingredients: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Nome do ingrediente" },
                    quantity: { type: Type.STRING, description: "Quantidade estimada (ex: 100g, 1 colher)" },
                    calories: { type: Type.NUMBER, description: "Calorias estimadas para esta quantidade baseadas em pesquisa" },
                  },
                  required: ["name", "quantity", "calories"],
                },
              },
            },
            required: ["dishName", "ingredients", "totalCalories", "description"],
          },
        },
      });

      const text = response.text;
      if (text) {
        setResult(JSON.parse(text));
        
        // Extract grounding sources
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks) {
          const sources = chunks
            .filter((chunk: any) => chunk.web)
            .map((chunk: any) => ({ 
              title: chunk.web.title || 'Fonte de pesquisa', 
              uri: chunk.web.uri 
            }));
          setGroundingSources(sources);
        } else {
          setGroundingSources([]);
        }
      } else {
        throw new Error("Não foi possível obter uma resposta da IA.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ocorreu um erro ao analisar a imagem. Por favor, tente novamente.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const saveMeal = () => {
    if (!result) return;

    const newMeal: MealRecord = {
      id: Math.random().toString(36).substr(2, 9),
      type: selectedMealType,
      dishName: result.dishName,
      calories: result.totalCalories,
      timestamp: Date.now(),
      image: image || undefined
    };

    const updatedMeals = [...dailyMeals, newMeal];
    setDailyMeals(updatedMeals);
    localStorage.setItem('ifome_daily_meals', JSON.stringify(updatedMeals));
    setSaveSuccess(true);
    
    // Auto reset after 2 seconds
    setTimeout(() => {
      reset();
      setSaveSuccess(false);
    }, 2000);
  };

  const deleteMeal = (id: string) => {
    const updatedMeals = dailyMeals.filter(m => m.id !== id);
    setDailyMeals(updatedMeals);
    localStorage.setItem('ifome_daily_meals', JSON.stringify(updatedMeals));
  };

  const reset = () => {
    setImage(null);
    setResult(null);
    setError(null);
    setSaveSuccess(false);
    setGroundingSources([]);
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMessage = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsChatLoading(true);

    try {
      const mealContext = dailyMeals.map(m => 
        `- ${m.type}: ${m.dishName} (${m.calories} kcal) às ${new Date(m.timestamp).toLocaleTimeString('pt-BR')}`
      ).join('\n');

      const profileContext = profile ? 
        `Usuário: ${profile.name}, ${profile.age} anos, ${profile.weight}kg, ${profile.height}cm. Meta diária: ${profile.calorieGoal} kcal.` : 
        'Perfil não configurado.';

      const systemInstruction = `Você é o NutriAI, um assistente nutricional especializado. Sempre dê respostas curtas e resumidas. No máximo 2 frases. 
      Contexto do usuário: ${profileContext}
      Refeições de hoje:
      ${mealContext || 'Nenhuma refeição registrada ainda.'}
      
      Total consumido hoje: ${totalConsumed} kcal de uma meta de ${profile?.calorieGoal || 0} kcal.
      
      Responda de forma motivadora, curta, direta, técnica e amigável. No máximo 2 frases. Use as informações acima para dar conselhos personalizados sobre a dieta do usuário.`;

      const response = await safeGenerateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          ...chatMessages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
          })),
          { role: 'user', parts: [{ text: userMessage }] }
        ],
        config: {
          systemInstruction,
          temperature: 0.7,
        }
      });

      const aiText = response.text || "Desculpe, não consegui processar sua dúvida agora.";
      setChatMessages(prev => [...prev, { role: 'model', text: aiText }]);
      handlePlaySpeech(aiText, chatMessages.length + 1);
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || "Ocorreu um erro ao tentar falar com o NutriAI. Verifique sua conexão.";
      setChatMessages(prev => [...prev, { role: 'model', text: errorMessage }]);
      handlePlaySpeech(errorMessage, chatMessages.length + 1);
    } finally {
      setIsChatLoading(false);
    }
  };

  const totalConsumed = dailyMeals.reduce((sum, m) => sum + m.calories, 0);

  if (showRegistration) {
    return (
      <div className="min-h-screen bg-stone-50 text-stone-900 font-sans flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-3xl shadow-xl border border-stone-200 w-full max-w-md"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="bg-emerald-600 p-4 rounded-2xl mb-4 shadow-lg shadow-emerald-100">
              <Utensils className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-emerald-800">Bem-vindo ao ifome</h1>
            <p className="text-stone-500 text-center mt-2">Vamos configurar seu perfil nutricional</p>
          </div>

          <form onSubmit={handleRegistrationSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Nome Completo</label>
              <input 
                required
                type="text" 
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Como quer ser chamado?"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Idade</label>
                <input 
                  required
                  type="number" 
                  value={formData.age}
                  onChange={e => setFormData({...formData, age: e.target.value})}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Ex: 25"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Peso (kg)</label>
                <input 
                  required
                  type="number" 
                  step="0.1"
                  value={formData.weight}
                  onChange={e => setFormData({...formData, weight: e.target.value})}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Ex: 75.5"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Altura (cm)</label>
                <input 
                  required
                  type="number" 
                  value={formData.height}
                  onChange={e => setFormData({...formData, height: e.target.value})}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Ex: 175"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Meta Calórica</label>
                <input 
                  required
                  type="number" 
                  value={formData.calorieGoal}
                  onChange={e => setFormData({...formData, calorieGoal: e.target.value})}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Ex: 2000"
                />
              </div>
            </div>

            <button 
              type="submit"
              className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 mt-4"
            >
              Começar minha jornada
              <ChevronRight className="w-5 h-5" />
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans pb-20">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <Utensils className="text-white w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-emerald-800">ifome</h1>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-full transition-colors ${showHistory ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-500 hover:bg-emerald-50'}`}
            >
              <History className="w-5 h-5" />
            </button>
            <button 
              onClick={() => {
                if (profile) {
                  setFormData({
                    name: profile.name,
                    age: String(profile.age),
                    weight: String(profile.weight),
                    height: String(profile.height),
                    calorieGoal: String(profile.calorieGoal)
                  });
                }
                setShowRegistration(true);
              }}
              className="bg-stone-100 p-2 rounded-full text-stone-500 hover:bg-emerald-100 hover:text-emerald-600 transition-colors"
            >
              <User className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Daily Summary Card */}
        {profile && (
          <div className="mb-8 bg-white rounded-3xl p-6 shadow-sm border border-stone-200 overflow-hidden relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-stone-800">Resumo de Hoje</h2>
                <p className="text-stone-400 text-sm">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-2xl font-black text-emerald-600">{totalConsumed} <span className="text-xs font-normal text-stone-400">kcal</span></p>
                  <p className="text-[10px] text-stone-400 uppercase tracking-widest font-bold">Consumidas</p>
                </div>
                <div className="w-px h-8 bg-stone-100" />
                <div className="text-right">
                  <p className="text-2xl font-black text-stone-300">{profile.calorieGoal} <span className="text-xs font-normal text-stone-400">kcal</span></p>
                  <p className="text-[10px] text-stone-400 uppercase tracking-widest font-bold">Meta</p>
                </div>
              </div>
            </div>

            <div className="relative h-4 bg-stone-100 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (totalConsumed / profile.calorieGoal) * 100)}%` }}
                className={`h-full transition-all duration-1000 ${totalConsumed > profile.calorieGoal ? 'bg-orange-500' : 'bg-emerald-500'}`}
              />
            </div>
            
            {totalConsumed > profile.calorieGoal && (
              <p className="mt-2 text-[10px] text-orange-600 font-bold uppercase tracking-tight flex items-center gap-1">
                <Info className="w-3 h-3" />
                Meta diária excedida em {totalConsumed - profile.calorieGoal} kcal
              </p>
            )}
          </div>
        )}

        {/* NutriAI Chat Section */}
        <div className="mb-8 bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden flex flex-col h-[400px]">
          <div className="p-4 border-b border-stone-100 bg-emerald-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-emerald-600 p-1.5 rounded-lg">
                <MessageSquare className="text-white w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-stone-800 text-sm">NutriAI Chat</h3>
                <p className="text-[10px] text-emerald-600 font-medium">Assistente Contextual</p>
              </div>
            </div>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            {chatMessages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-stone-400 px-8">
                <ChefHat className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">Olá! Eu sou o NutriAI. Com base no que você comeu hoje, como posso te ajudar?</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {['Como está minha meta?', 'Sugestão para o jantar?', 'Excedi as calorias?'].map(suggestion => (
                    <button 
                      key={suggestion}
                      onClick={() => {
                        setChatInput(suggestion);
                      }}
                      className="text-[10px] bg-stone-100 hover:bg-emerald-100 hover:text-emerald-700 px-3 py-1.5 rounded-full transition-colors font-medium"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                  msg.role === 'user' 
                    ? 'bg-emerald-600 text-white rounded-tr-none' 
                    : 'bg-stone-100 text-stone-800 rounded-tl-none border border-stone-200'
                }`}>
                  {msg.text}
                  {msg.role === 'model' && (
                    <button
                      onClick={() => handlePlaySpeech(msg.text, idx)}
                      className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 transition-colors"
                    >
                      {playingAudioId === idx ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          Parar
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3 h-3" />
                          Ouvir
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="bg-stone-100 p-3 rounded-2xl rounded-tl-none border border-stone-200 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                  <span className="text-xs text-stone-500">NutriAI está pensando...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleChatSubmit} className="p-3 border-t border-stone-100 bg-stone-50/50 flex gap-2">
            <input 
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Pergunte sobre sua dieta..."
              className="flex-1 bg-white border border-stone-200 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
            <button 
              type="submit"
              disabled={isChatLoading || !chatInput.trim()}
              className="bg-emerald-600 text-white p-2 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-md shadow-emerald-100"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>

        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-8 overflow-hidden"
            >
              <div className="bg-stone-100 rounded-3xl p-6 border border-stone-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-stone-700 flex items-center gap-2">
                    <History className="w-4 h-4" />
                    Refeições do Dia
                  </h3>
                  <span className="text-xs font-bold text-stone-400">{dailyMeals.length} registradas</span>
                </div>
                
                {dailyMeals.length === 0 ? (
                  <p className="text-center py-8 text-stone-400 text-sm italic">Nenhuma refeição registrada hoje.</p>
                ) : (
                  <div className="space-y-3">
                    {dailyMeals.map(meal => (
                      <div key={meal.id} className="bg-white p-4 rounded-2xl flex items-center justify-between shadow-sm border border-stone-200/50">
                        <div className="flex items-center gap-4">
                          {meal.image && (
                            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-stone-100">
                              <img src={meal.image} alt={meal.dishName} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div>
                            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">{meal.type}</p>
                            <p className="font-bold text-stone-800">{meal.dishName}</p>
                            <p className="text-[10px] text-stone-400">{new Date(meal.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-mono font-bold text-stone-600">{meal.calories} kcal</p>
                          </div>
                          <button 
                            onClick={() => deleteMeal(meal.id)}
                            className="p-2 text-stone-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Upload Section */}
          <section className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
              <div className="p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Camera className="w-5 h-5 text-emerald-600" />
                  Nova Refeição
                </h2>

                {/* Meal Type Selector */}
                <div className="mb-6">
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Qual refeição é esta?</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {MEAL_TYPES.map(type => (
                      <button
                        key={type}
                        onClick={() => setSelectedMealType(type)}
                        className={`text-[10px] py-2 px-1 rounded-lg border transition-all font-bold ${selectedMealType === type ? 'bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-100' : 'bg-white border-stone-100 text-stone-400 hover:border-emerald-200'}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                
                {!image ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-stone-200 rounded-xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all group"
                  >
                    <div className="bg-stone-100 p-4 rounded-full group-hover:bg-emerald-100 transition-colors">
                      <Upload className="w-8 h-8 text-stone-400 group-hover:text-emerald-600" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-stone-600">Clique para enviar uma foto</p>
                      <p className="text-sm text-stone-400">ou arraste e solte aqui</p>
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleImageUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </div>
                ) : (
                  <div className="relative rounded-xl overflow-hidden aspect-square bg-stone-100">
                    <img src={image} alt="Refeição" className="w-full h-full object-cover" />
                    <button 
                      onClick={reset}
                      className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-full hover:bg-black/70 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                )}

                {image && !result && !isAnalyzing && (
                  <button
                    onClick={analyzeImage}
                    className="w-full mt-6 bg-emerald-600 text-white py-3 rounded-xl font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 shadow-md shadow-emerald-200"
                  >
                    <ChefHat className="w-5 h-5" />
                    Analisar Prato
                  </button>
                )}

                {isAnalyzing && (
                  <div className="mt-6 flex flex-col items-center gap-3 py-4">
                    <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                    <p className="text-sm font-medium text-stone-500 animate-pulse">Identificando ingredientes...</p>
                  </div>
                )}

                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex items-start gap-2">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Results Section */}
          <section>
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase tracking-wider">{selectedMealType}</span>
                        </div>
                        <h2 className="text-2xl font-bold text-stone-800">{result.dishName}</h2>
                        <p className="text-stone-500 text-sm mt-1">{result.description}</p>
                      </div>
                      <div className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1">
                        <Flame className="w-4 h-4" />
                        {result.totalCalories} kcal
                      </div>
                    </div>

                    <div className="space-y-4 mt-8">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                        <Scale className="w-4 h-4" />
                        Ingredientes Estimados
                      </h3>
                      
                      <div className="divide-y divide-stone-100">
                        {result.ingredients.map((ing, idx) => (
                          <div key={idx} className="py-3 flex justify-between items-center group">
                            <div>
                              <p className="font-medium text-stone-700 group-hover:text-emerald-700 transition-colors">{ing.name}</p>
                              <p className="text-xs text-stone-400">{ing.quantity}</p>
                            </div>
                            <div className="text-sm font-mono text-stone-500">
                              {ing.calories} kcal
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {groundingSources.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-stone-100">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-3 flex items-center gap-2">
                          <Info className="w-3 h-3" />
                          Fontes de Pesquisa (Google Search)
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {groundingSources.map((source, idx) => (
                            <a 
                              key={idx}
                              href={source.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] bg-stone-100 text-stone-500 px-2 py-1 rounded hover:bg-emerald-50 hover:text-emerald-600 transition-colors truncate max-w-[200px]"
                            >
                              {source.title}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-8 flex gap-3">
                      <button 
                        onClick={saveMeal}
                        disabled={saveSuccess}
                        className={`flex-1 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${saveSuccess ? 'bg-emerald-100 text-emerald-700 shadow-none cursor-default' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-100'}`}
                      >
                        {saveSuccess ? (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            Registrado!
                          </>
                        ) : (
                          <>
                            <Save className="w-5 h-5" />
                            Salvar no Diário
                          </>
                        )}
                      </button>
                      <button 
                        onClick={reset}
                        className="p-4 bg-stone-100 text-stone-500 rounded-xl hover:bg-stone-200 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ) : !isAnalyzing && (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-stone-200 rounded-2xl text-stone-400">
                  <Utensils className="w-12 h-12 mb-4 opacity-20" />
                  <p className="max-w-[200px]">Envie uma foto para ver a análise nutricional detalhada</p>
                </div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-stone-400 text-sm">
          Feito com Gemini 2.5 Flash & React
        </p>
      </footer>
    </div>
  );
}
