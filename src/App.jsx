import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Square, Volume2, Disc3, Mic, Square as StopCircle, Upload, FolderOpen, Search, Trash2, SkipBack, SkipForward } from 'lucide-react';

// --- UTILIDADES DE BASE DE DATOS LOCAL (IndexedDB) ---
const DB_NAME = 'AudioForumDB';
const STORE_NAME = 'playlist';

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveFileToDB = async (file) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const id = `${file.name}-${file.size}`; 
  store.put({ id, file, name: file.name, size: file.size });
};

const loadFilesFromDB = async () => {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.map(item => item.file));
  });
};

const removeFileFromDB = async (file) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const id = `${file.name}-${file.size}`;
  store.delete(id);
};

const clearDB = async () => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.clear();
};
// -----------------------------------------------------

const App = () => {
  // Playlist States 
  const [files, setFiles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Playlist Auto-Player States
  const [playlistPlayer, setPlaylistPlayer] = useState({ isPlaying: false, currentIndex: 0 });

  // Deck States 
  const [deckA, setDeckA] = useState({ track: null, isPlaying: false, time: 0, duration: 0, pitch: 1 });
  const [deckB, setDeckB] = useState({ track: null, isPlaying: false, time: 0, duration: 0, pitch: 1 });
  
  // Mixer States
  const [crossfader, setCrossfader] = useState(50); // 0 to 100
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [eqValues, setEqValues] = useState([0, 0, 0, 0, 0, 0, 0]); // 7-band
  
  // Audio Effects (FX) States
  const [modeA, setModeA] = useState('normal'); 
  const [modeB, setModeB] = useState('normal');
  
  // Recording & UI States
  const [isRecording, setIsRecording] = useState(false);
  const [uiMessage, setUiMessage] = useState("");
  const [targetDeck, setTargetDeck] = useState(null);

  // Scrubbing (Scratch & Drag) States
  const [isScrubbing, setIsScrubbing] = useState(false);
  const lastMouseXRef = useRef(0);
  
  // Refs
  const isDraggingARef = useRef(false);
  const isDraggingBRef = useRef(false);
  const filesRef = useRef(files);
  const playlistIndexRef = useRef(playlistPlayer.currentIndex);

  const audioCtxRef = useRef(null);
  const audioARef = useRef(null);
  const audioBRef = useRef(null);
  const audioPlaylistRef = useRef(null); // Ref for AutoPlay Playlist
  const gainARef = useRef(null);
  const gainBRef = useRef(null);
  const masterGainRef = useRef(null);
  const mediaDestRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const eqFiltersRef = useRef([]);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const fxARef = useRef(null);
  const fxBRef = useRef(null);

  const fileInputRef = useRef(null);
  const playlistInputRef = useRef(null);

  // Mantener los refs sincronizados con el state para el evento 'onEnded'
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { playlistIndexRef.current = playlistPlayer.currentIndex; }, [playlistPlayer.currentIndex]);

  const showToast = (msg) => {
    setUiMessage(msg);
    setTimeout(() => setUiMessage(""), 3000);
  };

  useEffect(() => {
    const fetchSavedFiles = async () => {
      try {
        const savedFiles = await loadFilesFromDB();
        if (savedFiles && savedFiles.length > 0) {
          setFiles(savedFiles);
        }
      } catch (error) {
        console.error("Error al cargar la librería", error);
      }
    };
    fetchSavedFiles();
  }, []);

  const drawVisualizer = useCallback(function draw() {
    if (!analyserRef.current || !canvasRef.current) {
      animationRef.current = requestAnimationFrame(draw);
      return;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    analyserRef.current.getByteFrequencyData(dataArray);
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    const barWidth = (width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 2;
      
      const r = barHeight + (25 * (i/bufferLength));
      const g = 250 * (i/bufferLength);
      const b = 50;
      
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      x += barWidth + 1;
    }
    
    animationRef.current = requestAnimationFrame(draw);
  }, []);

  const updateCrossfaderAudio = useCallback((val) => {
    if (!gainARef.current || !gainBRef.current) return;
    const cf = val / 100;
    gainARef.current.gain.value = Math.cos(cf * 0.5 * Math.PI);
    gainBRef.current.gain.value = Math.cos((1 - cf) * 0.5 * Math.PI);
  }, []);

  const createFXGraph = (ctx, sourceNode) => {
    const input = ctx.createGain();
    sourceNode.connect(input);

    const normalGain = ctx.createGain();
    input.connect(normalGain);

    const echoGain = ctx.createGain();
    echoGain.gain.value = 0;
    
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.33;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;
    
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(echoGain);

    const radioGain = ctx.createGain();
    radioGain.gain.value = 0;
    
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1000;
    bandpass.Q.value = 2;

    const distortion = ctx.createWaveShaper();
    function makeDistortionCurve(amount) {
      let k = typeof amount === 'number' ? amount : 50,
        n_samples = 44100,
        curve = new Float32Array(n_samples),
        deg = Math.PI / 180, i = 0, x;
      for ( ; i < n_samples; ++i ) {
        x = i * 2 / n_samples - 1;
        curve[i] = ( 3 + k ) * x * 20 * deg / ( Math.PI + k * Math.abs(x) );
      }
      return curve;
    }
    distortion.curve = makeDistortionCurve(30);
    distortion.oversample = '4x';

    input.connect(bandpass);
    bandpass.connect(distortion);
    distortion.connect(radioGain);

    const output = ctx.createGain();
    normalGain.connect(output);
    echoGain.connect(output);
    radioGain.connect(output);

    return {
      output,
      setMode: (mode) => {
        const t = ctx.currentTime;
        if (mode === 'normal') {
            normalGain.gain.setTargetAtTime(1, t, 0.05);
            echoGain.gain.setTargetAtTime(0, t, 0.05);
            radioGain.gain.setTargetAtTime(0, t, 0.05);
        } else if (mode === 'echo') {
            normalGain.gain.setTargetAtTime(1, t, 0.05);
            echoGain.gain.setTargetAtTime(1, t, 0.05);
            radioGain.gain.setTargetAtTime(0, t, 0.05);
        } else if (mode === 'radio') {
            normalGain.gain.setTargetAtTime(0, t, 0.05);
            echoGain.gain.setTargetAtTime(0, t, 0.05);
            radioGain.gain.setTargetAtTime(1, t, 0.05);
        }
      }
    };
  };

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const srcA = ctx.createMediaElementSource(audioARef.current);
      const srcB = ctx.createMediaElementSource(audioBRef.current);
      const srcPlaylist = ctx.createMediaElementSource(audioPlaylistRef.current);

      fxARef.current = createFXGraph(ctx, srcA);
      fxBRef.current = createFXGraph(ctx, srcB);

      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      const gainPlaylist = ctx.createGain();
      const masterGain = ctx.createGain();
      
      gainARef.current = gainA;
      gainBRef.current = gainB;
      masterGainRef.current = masterGain;

      const frequencies = [60, 170, 310, 600, 3000, 6000, 14000];
      const filters = frequencies.map(freq => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        return filter;
      });
      eqFiltersRef.current = filters;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const mediaDest = ctx.createMediaStreamDestination();
      mediaDestRef.current = mediaDest;

      fxARef.current.output.connect(gainA);
      fxBRef.current.output.connect(gainB);
      srcPlaylist.connect(gainPlaylist); // Conectar playlist directo al master

      gainA.connect(masterGain);
      gainB.connect(masterGain);
      gainPlaylist.connect(masterGain);

      let lastNode = masterGain;
      filters.forEach(filter => {
        lastNode.connect(filter);
        lastNode = filter;
      });

      lastNode.connect(analyser);
      analyser.connect(ctx.destination);
      analyser.connect(mediaDest);

      updateCrossfaderAudio(50);
      drawVisualizer(); 
    }
    
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, [drawVisualizer, updateCrossfaderAudio]);

  useEffect(() => {
    if (fxARef.current) fxARef.current.setMode(modeA);
  }, [modeA]);

  useEffect(() => {
    if (fxBRef.current) fxBRef.current.setMode(modeB);
  }, [modeB]);

  useEffect(() => {
    updateCrossfaderAudio(crossfader);
  }, [crossfader, updateCrossfaderAudio]);

  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = masterVolume;
  }, [masterVolume]);

  useEffect(() => {
    eqFiltersRef.current.forEach((filter, index) => {
      filter.gain.value = eqValues[index];
    });
  }, [eqValues]);

  // --- Lógica del Auto-Player de la Librería ---
  const playPlaylistTrack = (index) => {
    initAudio();
    const currentFiles = filesRef.current;
    if (index < 0 || index >= currentFiles.length) return;
    
    const file = currentFiles[index];
    const objectUrl = URL.createObjectURL(file);
    
    if (audioPlaylistRef.current.src) URL.revokeObjectURL(audioPlaylistRef.current.src);
    
    audioPlaylistRef.current.src = objectUrl;
    audioPlaylistRef.current.play().then(() => {
      setPlaylistPlayer({ isPlaying: true, currentIndex: index });
    }).catch(e => console.error("Error reproduciendo lista", e));
  };

  const handlePlaylistEnded = () => {
    const nextIndex = playlistIndexRef.current + 1;
    if (nextIndex < filesRef.current.length) {
      playPlaylistTrack(nextIndex);
    } else {
      setPlaylistPlayer(prev => ({ ...prev, isPlaying: false, currentIndex: 0 }));
    }
  };

  const togglePlaylistPlay = () => {
    initAudio();
    if (files.length === 0) return showToast("La lista está vacía.");
    
    if (playlistPlayer.isPlaying) {
      audioPlaylistRef.current.pause();
      setPlaylistPlayer(prev => ({ ...prev, isPlaying: false }));
    } else {
      if (!audioPlaylistRef.current.src || audioPlaylistRef.current.ended) {
        playPlaylistTrack(playlistPlayer.currentIndex);
      } else {
        audioPlaylistRef.current.play();
        setPlaylistPlayer(prev => ({ ...prev, isPlaying: true }));
      }
    }
  };

  const playPlaylistNext = () => {
    if (playlistPlayer.currentIndex + 1 < files.length) {
      playPlaylistTrack(playlistPlayer.currentIndex + 1);
    }
  };

  const playPlaylistPrev = () => {
    if (playlistPlayer.currentIndex - 1 >= 0) {
      playPlaylistTrack(playlistPlayer.currentIndex - 1);
    } else {
      audioPlaylistRef.current.currentTime = 0; // Reiniciar si es la primera
    }
  };
  // ---------------------------------------------

  const triggerLoad = (deckId) => {
    setTargetDeck(deckId);
    fileInputRef.current.click();
  };

  const loadTrackToDeck = (file, deckId) => {
    initAudio(); 
    const objectUrl = URL.createObjectURL(file);
    
    if (deckId === 'A') {
      if (audioARef.current.src) URL.revokeObjectURL(audioARef.current.src);
      audioARef.current.src = objectUrl;
      setDeckA(prev => ({ ...prev, track: file, isPlaying: false, time: 0, duration: 0, pitch: 1 }));
      audioARef.current.playbackRate = 1;
      setModeA('normal');
    } else {
      if (audioBRef.current.src) URL.revokeObjectURL(audioBRef.current.src);
      audioBRef.current.src = objectUrl;
      setDeckB(prev => ({ ...prev, track: file, isPlaying: false, time: 0, duration: 0, pitch: 1 }));
      audioBRef.current.playbackRate = 1;
      setModeB('normal');
    }
    showToast(`Pista cargada en el DECK ${deckId}`);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file || !targetDeck) return;
    loadTrackToDeck(file, targetDeck);
    setTargetDeck(null);
    e.target.value = null; 
  };

  const handlePlaylistChange = async (e) => {
    const newFiles = Array.from(e.target.files);
    if (newFiles.length > 0) {
      const currentFileIds = files.map(f => `${f.name}-${f.size}`);
      const uniqueNewFiles = newFiles.filter(f => !currentFileIds.includes(`${f.name}-${f.size}`));

      if (uniqueNewFiles.length > 0) {
        for (const file of uniqueNewFiles) {
          await saveFileToDB(file);
        }
        setFiles(prev => [...prev, ...uniqueNewFiles]);
        showToast(`${uniqueNewFiles.length} pistas guardadas en la librería.`);
      } else {
        showToast(`Las pistas seleccionadas ya están en la librería.`);
      }
    }
    e.target.value = null;
  };

  const removeTrackFromPlaylist = async (fileToRemove) => {
    const indexToRemove = files.indexOf(fileToRemove);
    await removeFileFromDB(fileToRemove);
    
    setFiles(prev => prev.filter(f => f !== fileToRemove));
    
    // Si eliminamos la canción que está sonando en el AutoPlay
    if (playlistPlayer.currentIndex === indexToRemove) {
      audioPlaylistRef.current.pause();
      audioPlaylistRef.current.src = "";
      setPlaylistPlayer({ isPlaying: false, currentIndex: 0 });
    } else if (playlistPlayer.currentIndex > indexToRemove) {
      setPlaylistPlayer(prev => ({ ...prev, currentIndex: prev.currentIndex - 1 }));
    }
    showToast(`Pista eliminada de la librería.`);
  };

  const clearEntirePlaylist = async () => {
    if (window.confirm("¿Estás seguro de que quieres borrar TODA la librería de pistas guardadas?")) {
      audioPlaylistRef.current.pause();
      audioPlaylistRef.current.src = "";
      setPlaylistPlayer({ isPlaying: false, currentIndex: 0 });
      
      await clearDB();
      setFiles([]);
      showToast(`Librería vaciada completamente.`);
    }
  };

  const togglePlay = async (deckId) => {
    initAudio();
    const audio = deckId === 'A' ? audioARef.current : audioBRef.current;
    const isPlaying = deckId === 'A' ? deckA.isPlaying : deckB.isPlaying;
    const setDeck = deckId === 'A' ? setDeckA : setDeckB;

    if (!audio.src) {
        showToast(`Carga una pista en el Deck ${deckId} primero.`);
        return;
    }

    if (isPlaying) {
      audio.pause();
      setDeck(prev => ({ ...prev, isPlaying: false }));
    } else {
      try {
        await audio.play();
        setDeck(prev => ({ ...prev, isPlaying: true }));
      } catch (e) {
        console.error("Audio play failed", e);
      }
    }
  };

  const stopDeck = (deckId) => {
    const audio = deckId === 'A' ? audioARef.current : audioBRef.current;
    if (!audio.src) return;
    audio.pause();
    audio.currentTime = 0;
    if (deckId === 'A') setDeckA(prev => ({ ...prev, isPlaying: false, time: 0 }));
    if (deckId === 'B') setDeckB(prev => ({ ...prev, isPlaying: false, time: 0 }));
  };

  const changePitch = (deckId, newPitch) => {
    const audio = deckId === 'A' ? audioARef.current : audioBRef.current;
    if (audio) audio.playbackRate = newPitch;
    if (deckId === 'A') setDeckA(prev => ({ ...prev, pitch: newPitch }));
    if (deckId === 'B') setDeckB(prev => ({ ...prev, pitch: newPitch }));
  };

  const handleSeek = (deckId, newTime) => {
    const audio = deckId === 'A' ? audioARef.current : audioBRef.current;
    if (audio && !isNaN(audio.duration)) {
      audio.currentTime = newTime;
    }
  };

  useEffect(() => {
    const updateTimeA = () => {
      if (!isDraggingARef.current) {
        setDeckA(prev => ({ ...prev, time: audioARef.current.currentTime, duration: audioARef.current.duration || 0 }));
      }
    };
    const updateTimeB = () => {
      if (!isDraggingBRef.current) {
        setDeckB(prev => ({ ...prev, time: audioBRef.current.currentTime, duration: audioBRef.current.duration || 0 }));
      }
    };
    
    const aRef = audioARef.current;
    const bRef = audioBRef.current;
    
    if (aRef) aRef.addEventListener('timeupdate', updateTimeA);
    if (bRef) bRef.addEventListener('timeupdate', updateTimeB);
    
    return () => {
      if (aRef) aRef.removeEventListener('timeupdate', updateTimeA);
      if (bRef) bRef.removeEventListener('timeupdate', updateTimeB);
    };
  }, []);

  const handleScrubStart = (e) => {
    setIsScrubbing(true);
    lastMouseXRef.current = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
  };

  useEffect(() => {
    const handleScrubMove = (e) => {
      if (!isScrubbing) return;
      if (e.cancelable) e.preventDefault();
      
      const currentX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const deltaX = currentX - lastMouseXRef.current;
      lastMouseXRef.current = currentX;

      const timeDelta = deltaX * 0.05; 

      [audioARef.current, audioBRef.current].forEach(audio => {
        if (audio && audio.src && !isNaN(audio.duration)) {
          let newTime = audio.currentTime + timeDelta;
          audio.currentTime = Math.max(0, Math.min(newTime, audio.duration));
        }
      });
    };

    const handleScrubEnd = () => setIsScrubbing(false);

    if (isScrubbing) {
      window.addEventListener('mousemove', handleScrubMove, { passive: false });
      window.addEventListener('mouseup', handleScrubEnd);
      window.addEventListener('touchmove', handleScrubMove, { passive: false });
      window.addEventListener('touchend', handleScrubEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleScrubMove);
      window.removeEventListener('mouseup', handleScrubEnd);
      window.removeEventListener('touchmove', handleScrubMove);
      window.removeEventListener('touchmove', handleScrubEnd);
    };
  }, [isScrubbing]);

  const toggleRecording = () => {
    initAudio();
    if (!isRecording) {
      const options = { mimeType: 'audio/webm' };
      try {
        const recorder = new MediaRecorder(mediaDestRef.current.stream, options);
        recordedChunksRef.current = [];
        
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        
        recorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          document.body.appendChild(a);
          a.style = 'display: none';
          a.href = url;
          a.download = `mezcla_audioforum_${new Date().getTime()}.webm`;
          a.click();
          URL.revokeObjectURL(url);
          showToast("¡Mezcla guardada exitosamente!");
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
        showToast("Grabación Iniciada...");
      } catch (e) {
        console.error("Recording failed", e);
        showToast("Error al grabar (tu navegador podría no soportarlo).");
      }
    } else {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds) || !timeInSeconds) return "00:00";
    const m = Math.floor(timeInSeconds / 60).toString().padStart(2, '0');
    const s = Math.floor(timeInSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const filteredFiles = files.filter(file => 
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const Deck = ({ id, deckState }) => (
    <div className="flex-1 winamp-panel p-3 rounded-lg flex flex-col relative h-full w-full lg:w-auto">
      <div className="absolute top-0 left-0 w-full text-center text-[10px] text-gray-400 bg-gray-900 border-b border-gray-600 rounded-t-lg py-1 font-bold tracking-widest">
        DECK {id} - PLAYER
      </div>
      
      <div className="mt-5 bg-black p-3 rounded border-2 border-gray-700 shadow-inner flex flex-col gap-2 relative">
        <div className="flex justify-between items-center mb-1">
           <div className="retro-text text-xs lg:text-sm truncate bg-black/50 px-1 font-bold flex-1 mr-2">
             {deckState.track ? `${id}: ${deckState.track.name.replace(/\.[^/.]+$/, "")}` : `--- PISTA VACÍA ---`}
           </div>
           <button 
             onClick={() => triggerLoad(id)} 
             className="retro-btn text-[9px] px-2 py-1 font-bold flex items-center gap-1 shrink-0"
           >
             <Upload size={10} /> CARGAR
           </button>
        </div>
        
        <div className="flex justify-between items-end mb-1">
          <div className="text-3xl lg:text-4xl text-green-500 font-mono font-bold tracking-widest" style={{ textShadow: '0 0 5px #4ade80' }}>
            {formatTime(deckState.time)}
          </div>
          <div className="text-right">
             <div className="text-green-600 font-mono text-[10px] lg:text-xs mb-1">
               {deckState.isPlaying ? '▶ PLAYING' : '■ STOPPED'}
             </div>
             <div className="text-green-400 font-mono text-[10px] lg:text-xs bg-green-900/30 px-1 border border-green-800 rounded">
               SPD: {(deckState.pitch * 100).toFixed(0)}%
             </div>
          </div>
        </div>

        <div className="h-4 flex items-center mt-1">
          <input 
            type="range"
            min="0"
            max={deckState.duration || 1}
            step="0.01"
            value={deckState.time}
            onMouseDown={() => { if(id === 'A') isDraggingARef.current = true; else isDraggingBRef.current = true; }}
            onMouseUp={(e) => {
               if(id === 'A') isDraggingARef.current = false; else isDraggingBRef.current = false;
               handleSeek(id, parseFloat(e.target.value));
            }}
            onTouchStart={() => { if(id === 'A') isDraggingARef.current = true; else isDraggingBRef.current = true; }}
            onTouchEnd={(e) => {
               if(id === 'A') isDraggingARef.current = false; else isDraggingBRef.current = false;
               handleSeek(id, parseFloat(e.target.value));
            }}
            onChange={(e) => {
               const val = parseFloat(e.target.value);
               if (id === 'A') setDeckA(prev => ({...prev, time: val}));
               if (id === 'B') setDeckB(prev => ({...prev, time: val}));
               handleSeek(id, val);
            }}
            className="progress-slider w-full"
            disabled={!deckState.track}
            title="Arrastra para devolver o adelantar la pista"
          />
        </div>
      </div>

      <div className="flex gap-4 mt-auto items-center justify-between pt-4">
        <div className="flex gap-2">
          <button onClick={() => togglePlay(id)} className="retro-btn w-12 h-12 lg:w-16 lg:h-14 flex justify-center items-center">
            {deckState.isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button onClick={() => stopDeck(id)} className="retro-btn w-12 h-12 lg:w-16 lg:h-14 flex justify-center items-center">
            <Square size={20} fill="currentColor" />
          </button>
        </div>
        
        <div className="flex items-center gap-2 bg-gray-800 p-2 rounded border border-gray-600">
           <span className="text-[9px] text-gray-400 font-bold rotate-180 hidden lg:block" style={{writingMode: 'vertical-rl'}}>PITCH</span>
           <span className="text-[9px] text-gray-400 font-bold lg:hidden">PTCH</span>
           <div className="h-20 lg:h-28 flex items-center">
              <input 
                type="range" 
                min="0.7" max="1.3" step="0.01"
                value={deckState.pitch}
                onChange={(e) => changePitch(id, parseFloat(e.target.value))}
                className="eq-slider h-full"
                style={{ width: '80px', margin: '40px -30px' }} 
              />
           </div>
           <button 
             onClick={() => changePitch(id, 1)} 
             className="text-[9px] bg-gray-700 hover:bg-gray-600 px-1 py-2 rounded border border-gray-500 font-bold shadow-sm active:translate-y-[1px]"
           >
             RST
           </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#111] text-gray-200 font-sans overflow-x-hidden select-none p-2 lg:p-4">
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes custom-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        button, input[type="range"], .retro-btn {
          touch-action: manipulation;
        }
        .winamp-panel {
          background: linear-gradient(to bottom, #3b3b4f, #2a2a38);
          border-top: 2px solid #5a5a75;
          border-left: 2px solid #5a5a75;
          border-bottom: 2px solid #15151c;
          border-right: 2px solid #15151c;
          box-shadow: 4px 4px 15px rgba(0,0,0,0.8);
        }
        .retro-text {
          font-family: 'Courier New', Courier, monospace;
          color: #4ade80;
        }
        .retro-btn {
          background-color: #d1d5db;
          color: #000;
          border-radius: 4px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          border-bottom: 3px solid #6b7280;
          border-right: 1px solid #6b7280;
          transition: all 0.05s ease;
          cursor: pointer;
        }
        .retro-btn:active {
          border-bottom-width: 0px;
          transform: translateY(3px);
          background-color: #f3f4f6;
        }
        .retro-btn.active-mode {
          background-color: #4ade80;
          border-bottom-width: 0px;
          transform: translateY(3px);
          box-shadow: 0 0 10px rgba(74, 222, 128, 0.5);
        }
        .eq-slider {
          -webkit-appearance: none; background: transparent; height: 8px; transform: rotate(-90deg); transform-origin: center;
        }
        .eq-slider::-webkit-slider-runnable-track {
          width: 100%; height: 6px; background: #111; border: 1px solid #444; border-radius: 2px;
        }
        .eq-slider::-webkit-slider-thumb {
          -webkit-appearance: none; height: 26px; width: 16px; border-radius: 2px;
          background: #ccc; border: 1px solid #fff; border-bottom: 2px solid #555; border-right: 2px solid #555;
          margin-top: -11px; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.5);
        }
        .normal-slider {
          -webkit-appearance: none; width: 100%; height: 8px; background: #111; border: 1px solid #444; border-radius: 3px;
        }
        .normal-slider::-webkit-slider-thumb {
          -webkit-appearance: none; height: 30px; width: 16px; background: #ccc;
          border: 1px solid #fff; border-bottom: 2px solid #555; border-right: 2px solid #555;
          border-radius: 2px; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.5);
        }
        .progress-slider {
          -webkit-appearance: none; width: 100%; height: 16px; background: transparent; cursor: pointer; position: relative;
        }
        .progress-slider::-webkit-slider-runnable-track {
          width: 100%; height: 6px; background: #111; border: 1px solid #444; border-radius: 3px;
        }
        .progress-slider::-webkit-slider-thumb {
          -webkit-appearance: none; height: 18px; width: 10px; background: #4ade80; border-radius: 2px;
          box-shadow: 0 0 8px rgba(74, 222, 128, 0.8); margin-top: -7px; border: 1px solid #fff;
        }
        .progress-slider:disabled {
          opacity: 0.3; cursor: not-allowed;
        }
      `}} />

      {/* Main audio elements */}
      <audio ref={audioARef} />
      <audio ref={audioBRef} />
      {/* Hidden audio element exclusively for the Auto-Playlist */}
      <audio ref={audioPlaylistRef} onEnded={handlePlaylistEnded} />

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*,.mp3,.wav,.ogg,.m4a" className="hidden" />
      <input type="file" ref={playlistInputRef} onChange={handlePlaylistChange} multiple accept="audio/*,.mp3,.wav,.ogg,.m4a" className="hidden" />

      {uiMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-500 text-black font-bold px-4 py-2 text-sm lg:px-6 lg:py-2 lg:text-base rounded-full z-50 shadow-[0_0_15px_#4ade80] border-2 border-black whitespace-nowrap">
          {uiMessage}
        </div>
      )}

      {/* Main Content Area */}
      <div className="bg-[#1e1e24] w-full p-3 lg:p-6 rounded-xl border-2 lg:border-4 border-gray-800 shadow-2xl flex flex-col gap-4 mx-auto max-w-[1200px]">
        
        {/* Header Responsivo */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-3 w-full">
          <div className="flex items-center gap-2 lg:gap-3">
             <Disc3 className="text-green-500 shrink-0" size={24} />
             <div className="text-gray-300 font-bold tracking-widest text-sm lg:text-lg text-center md:text-left">
               AUDIOFORUM / ESTACIÓN DJ + FX
             </div>
          </div>
          <button 
            onClick={toggleRecording}
            className={`flex items-center justify-center gap-2 px-4 py-2 w-full md:w-auto font-bold rounded shadow-lg transition-all border-b-2 active:border-b-0 active:translate-y-[2px]
              ${isRecording ? 'bg-red-600 text-white border-red-800 animate-pulse' : 'bg-gray-300 text-black border-gray-500 hover:bg-white'}`}
          >
            {isRecording ? <StopCircle size={18} fill="currentColor" /> : <Mic size={18} />}
            <span className="text-sm lg:text-base">{isRecording ? 'GRABANDO SESIÓN...' : 'GRABAR MEZCLA'}</span>
          </button>
        </div>

        {/* TOP ROW: Deck A | Center Mixer/Disc | Deck B */}
        <div className="flex flex-col lg:flex-row gap-4 h-auto lg:h-[360px] w-full">
          <Deck id="A" deckState={deckA} />

          {/* CENTRAL MIXER & DISC */}
          <div className="winamp-panel p-3 rounded-lg flex flex-col relative w-full lg:w-[340px] shrink-0 items-center justify-between min-h-[300px] lg:min-h-0">
            <div className="absolute top-0 left-0 w-full text-center text-[10px] text-gray-400 bg-gray-900 border-b border-gray-600 rounded-t-lg py-1 font-bold tracking-widest">
              MIX MASTER
            </div>

            <div className="mt-5 w-full max-w-[280px] bg-black p-1 rounded border-2 border-gray-700 h-10 mb-2">
              <canvas ref={canvasRef} width="280" height="30" className="w-full h-full bg-[#050505] rounded opacity-90"></canvas>
            </div>

            <div 
              onMouseDown={handleScrubStart}
              onTouchStart={handleScrubStart}
              className={`relative flex justify-center items-center h-28 w-28 lg:h-36 lg:w-36 shrink-0 aspect-square rounded-full border-[6px] border-[#15151c] bg-black shadow-[0_4px_15px_rgba(0,0,0,0.8)] my-2 cursor-grab select-none touch-none ${isScrubbing ? 'cursor-grabbing' : ''}`}
              style={{ 
                animation: (deckA.isPlaying || deckB.isPlaying || playlistPlayer.isPlaying) && !isScrubbing ? 'custom-spin 2s linear infinite' : 'none',
                transform: isScrubbing ? 'scale(0.95)' : 'scale(1)',
                transition: 'transform 0.1s ease'
              }}
              title="Arrastra a los lados para hacer Scratch"
            >
              <div className="absolute inset-1 rounded-full border border-gray-800"></div>
              <div className="absolute inset-3 rounded-full border border-gray-700"></div>
              <div className="absolute inset-5 rounded-full border border-gray-800"></div>
              <div className="absolute inset-7 rounded-full border border-gray-700"></div>
              <div className="absolute inset-9 rounded-full border border-gray-800"></div>
              
              <div className="absolute h-10 w-10 lg:h-12 lg:w-12 rounded-full bg-gradient-to-br from-green-600 to-green-800 border-2 border-gray-400 flex items-center justify-center">
                 <div className="text-[4px] lg:text-[5px] font-bold text-black absolute top-1 lg:top-1.5 tracking-widest">AUDIOFORUM</div>
                 <div className="h-2 w-2 rounded-full bg-black border border-gray-300"></div>
              </div>
            </div>

            <div className="w-full flex flex-col gap-2 mt-auto">
              <div className="bg-gray-900 border-2 border-gray-700 rounded flex justify-between items-center px-2 lg:px-4 py-1.5">
                 {['60', '310', '1K', '6K', '14K'].map((label, index) => {
                   const mapIndex = index === 0 ? 0 : index === 1 ? 2 : index === 2 ? 4 : index === 3 ? 5 : 6;
                   return (
                   <div key={index} className="flex flex-col items-center">
                     <div className="h-16 flex items-center justify-center w-4">
                       <input 
                         type="range" min="-12" max="12" step="0.1"
                         value={eqValues[mapIndex]}
                         onChange={(e) => {
                           const newEq = [...eqValues];
                           newEq[mapIndex] = parseFloat(e.target.value);
                           setEqValues(newEq);
                         }}
                         className="eq-slider"
                         style={{ width: '60px', margin: '30px -25px' }}
                       />
                     </div>
                     <span className="text-[8px] text-gray-400 mt-2 font-bold">{label}</span>
                   </div>
                 )})}
              </div>

              <div className="bg-[#252530] p-2.5 rounded border border-gray-600 flex flex-col gap-3">
                 <div className="flex items-center gap-3">
                    <Volume2 size={16} className="text-gray-400" />
                    <input 
                      type="range" min="0" max="1" step="0.01" 
                      value={masterVolume} onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                      className="normal-slider flex-1"
                    />
                 </div>
                 <div className="flex flex-col">
                   <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-1">
                     <span className="text-green-500">DECK A</span>
                     <span>CROSSFADER</span>
                     <span className="text-green-500">DECK B</span>
                   </div>
                   <input 
                      type="range" min="0" max="100" step="1" 
                      value={crossfader} onChange={(e) => setCrossfader(parseFloat(e.target.value))}
                      className="normal-slider w-full"
                      style={{ height: '14px' }}
                    />
                 </div>
              </div>
            </div>
          </div>

          <Deck id="B" deckState={deckB} />
        </div>

        {/* BOTTOM ROW: Efectos de Sonido (FX) */}
        <div className="winamp-panel p-3 rounded-lg w-full flex flex-col relative mt-2">
           <div className="absolute top-0 left-0 w-full text-center text-[10px] text-gray-400 bg-gray-900 border-b border-gray-600 rounded-t-lg py-1 font-bold tracking-widest">
              MÓDULO DE EFECTOS DE SONIDO (FX)
           </div>

           <div className="mt-5 flex flex-col lg:flex-row gap-4 w-full h-full">
              {/* Controles FX DECK A */}
              <div className="flex-1 bg-black/40 border border-gray-700 rounded p-3 flex flex-col items-center">
                 <span className="text-green-500 font-bold text-xs tracking-widest mb-3">FX DECK A</span>
                 <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full justify-center">
                    <button 
                      onClick={() => setModeA('normal')}
                      className={`retro-btn text-[10px] px-3 py-2 font-bold flex-1 min-w-[80px] ${modeA === 'normal' ? 'active-mode' : ''}`}
                    >
                      NORMAL
                    </button>
                    <button 
                      onClick={() => setModeA('echo')}
                      className={`retro-btn text-[10px] px-3 py-2 font-bold flex-1 min-w-[80px] ${modeA === 'echo' ? 'active-mode' : ''}`}
                    >
                      ECHO DELAY
                    </button>
                    <button 
                      onClick={() => setModeA('radio')}
                      className={`retro-btn text-[10px] px-3 py-2 font-bold flex-1 min-w-[80px] ${modeA === 'radio' ? 'active-mode' : ''}`}
                    >
                      RADIO EQ
                    </button>
                 </div>
              </div>

              {/* Separador Central para PC */}
              <div className="w-full lg:w-1 h-1 lg:h-auto bg-gray-800 rounded"></div>

              {/* Controles FX DECK B */}
              <div className="flex-1 bg-black/40 border border-gray-700 rounded p-3 flex flex-col items-center">
                 <span className="text-green-500 font-bold text-xs tracking-widest mb-3">FX DECK B</span>
                 <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full justify-center">
                    <button 
                      onClick={() => setModeB('normal')}
                      className={`retro-btn text-[10px] px-3 py-2 font-bold flex-1 min-w-[80px] ${modeB === 'normal' ? 'active-mode' : ''}`}
                    >
                      NORMAL
                    </button>
                    <button 
                      onClick={() => setModeB('echo')}
                      className={`retro-btn text-[10px] px-3 py-2 font-bold flex-1 min-w-[80px] ${modeB === 'echo' ? 'active-mode' : ''}`}
                    >
                      ECHO DELAY
                    </button>
                    <button 
                      onClick={() => setModeB('radio')}
                      className={`retro-btn text-[10px] px-3 py-2 font-bold flex-1 min-w-[80px] ${modeB === 'radio' ? 'active-mode' : ''}`}
                    >
                      RADIO EQ
                    </button>
                 </div>
              </div>
           </div>
        </div>

        {/* LIBRERÍA DE PISTAS LOCAL (PLAYLIST) */}
        <div className="winamp-panel p-2 rounded-lg w-full flex flex-col min-h-[250px]">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-800 p-2 mb-2 border border-gray-600 rounded gap-3">
            <span className="text-xs text-gray-300 font-bold ml-1 lg:ml-2 tracking-widest flex items-center gap-2 whitespace-nowrap">
               <FolderOpen size={16}/> LIBRERÍA / AUTOPLAY
            </span>

            {/* MINIREPRODUCTOR DE LA LISTA */}
            <div className="flex items-center bg-black border border-gray-600 rounded px-2 gap-2 h-8">
              <button onClick={playPlaylistPrev} className="text-gray-400 hover:text-white transition-colors"><SkipBack size={14} /></button>
              <button 
                 onClick={togglePlaylistPlay} 
                 className={`font-bold flex items-center gap-1 transition-colors ${playlistPlayer.isPlaying ? 'text-green-400' : 'text-gray-400 hover:text-white'}`}
              >
                {playlistPlayer.isPlaying ? <Pause size={14} /> : <Play size={14} />}
                <span className="text-[10px] tracking-wider ml-1">AUTOPLAY</span>
              </button>
              <button onClick={playPlaylistNext} className="text-gray-400 hover:text-white transition-colors"><SkipForward size={14} /></button>
            </div>
            
            <div className="flex-1 flex flex-col sm:flex-row items-center gap-3 w-full justify-end">
               <div className="flex-1 flex items-center bg-black border border-gray-600 rounded px-2 w-full max-w-[300px]">
                  <Search size={14} className="text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="BUSCAR..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent text-xs text-green-400 font-mono outline-none p-1.5 w-full placeholder-gray-600"
                  />
               </div>

               <div className="flex gap-2 w-full sm:w-auto">
                 <button 
                   onClick={clearEntirePlaylist}
                   className="retro-btn text-xs px-3 py-2 lg:py-1.5 font-bold w-full sm:w-auto whitespace-nowrap bg-red-900/40 text-red-200 hover:bg-red-800"
                   title="Borrar todas las pistas guardadas"
                 >
                   VACIAR
                 </button>
                 <button 
                   onClick={() => playlistInputRef.current?.click()}
                   className="retro-btn text-xs px-4 py-2 lg:py-1.5 font-bold w-full sm:w-auto whitespace-nowrap"
                 >
                   + AÑADIR ARCHIVOS
                 </button>
               </div>
            </div>
          </div>
          
          <div className="flex-1 bg-black border-2 border-gray-700 rounded overflow-y-auto p-2 custom-scrollbar">
            {files.length === 0 ? (
              <div className="retro-text text-sm opacity-50 text-center mt-6 flex flex-col items-center gap-2 p-4">
                <Disc3 size={32} />
                No hay música cargada en la lista.<br/>Haz clic en '+ AÑADIR ARCHIVOS' para agregar tu música.
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="retro-text text-sm opacity-50 text-center mt-6 flex flex-col items-center gap-2 p-4">
                <Search size={32} />
                No se encontraron pistas que coincidan con "{searchQuery}".
              </div>
            ) : (
              <ul className="space-y-1">
                {filteredFiles.map((file, index) => {
                  const originalIndex = files.indexOf(file);
                  const isCurrentlyPlaying = playlistPlayer.isPlaying && playlistPlayer.currentIndex === originalIndex;
                  return (
                  <li key={`${file.name}-${file.size}-${index}`} 
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-2 hover:bg-gray-900 border-b border-gray-800 group gap-2 sm:gap-0 transition-colors
                                  ${isCurrentlyPlaying ? 'bg-green-900/30 border-l-4 border-l-green-500' : 'border-l-4 border-l-transparent'}`}>
                    
                    <div className="flex items-center flex-1 w-full sm:w-auto truncate overflow-hidden">
                      {/* Botón para reproducir ESTA canción en el AutoPlay */}
                      <button 
                        onClick={() => playPlaylistTrack(originalIndex)}
                        className={`mr-3 p-1.5 rounded-full transition-colors ${isCurrentlyPlaying ? 'bg-green-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                        title="Reproducir desde aquí (AutoPlay)"
                      >
                         {isCurrentlyPlaying ? <Pause size={12} fill="currentColor"/> : <Play size={12} fill="currentColor" className="ml-0.5" />}
                      </button>
                      
                      <span className={`retro-text text-xs lg:text-base truncate font-bold ${isCurrentlyPlaying ? 'text-green-400' : 'text-gray-400'}`}>
                        {originalIndex + 1}. {file.name.replace(/\.[^/.]+$/, "")}
                      </span>
                    </div>

                    <div className="flex gap-2 w-full sm:w-auto px-1 items-center justify-end">
                      <button 
                        onClick={() => loadTrackToDeck(file, 'A')}
                        className="retro-btn flex-1 sm:flex-none text-[10px] lg:text-xs px-2 lg:px-4 py-1.5 font-bold"
                      >
                        CARGAR A
                      </button>
                      <button 
                        onClick={() => loadTrackToDeck(file, 'B')}
                        className="retro-btn flex-1 sm:flex-none text-[10px] lg:text-xs px-2 lg:px-4 py-1.5 font-bold"
                      >
                        CARGAR B
                      </button>
                      <button
                        onClick={() => removeTrackFromPlaylist(file)}
                        className="p-1.5 rounded bg-red-900/30 hover:bg-red-800 text-red-500 hover:text-white border border-red-800 transition-colors ml-1"
                        title="Eliminar pista"
                      >
                         <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                )})}
              </ul>
            )}
          </div>
          
          <div className="mt-2 flex justify-end gap-2">
             <div className="bg-black border border-gray-700 px-3 py-1 retro-text text-[10px] flex items-center font-bold">
               {searchQuery ? `${filteredFiles.length} / ${files.length}` : files.length} PISTAS CARGADAS
             </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default App;