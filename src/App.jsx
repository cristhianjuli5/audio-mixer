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

  // Lyrics States
  const [lyrics, setLyrics] = useState('');
  const [showLyrics, setShowLyrics] = useState(false);

  // Waveform States
  const [waveformData, setWaveformData] = useState({ A: null, B: null });

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

  // Update lyrics when track changes
  useEffect(() => {
    let isCurrent = true;
    const activeTrack = deckA.track?.name || deckB.track?.name || "";
    
    const fetchLyricsForTrack = async (filename) => {
      try {
        let cleanName = filename.replace(/\.[^/.]+$/, ""); 
        cleanName = cleanName.replace(/\([^)]*\)/g, "");
        cleanName = cleanName.replace(/\[[^\]]*\]/g, "");
        cleanName = cleanName.replace(/_|-/g, " ");
        cleanName = cleanName.trim();

        const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanName)}`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0 && (data[0].plainLyrics || data[0].syncedLyrics)) {
            if (!isCurrent) return;
            const foundLyrics = data[0].plainLyrics || data[0].syncedLyrics;
            setLyrics(foundLyrics);
            localStorage.setItem(`lyrics_${filename}`, foundLyrics);
            showToast("DATOS_RECUPERADOS: Letras sincronizadas.");
            return;
          }
        }
        
        if (isCurrent) setLyrics("NO_SE_ENCONTRARON_LETRAS_EN_LA_RED.\n\nPuedes escribirlas o pegarlas manualmente aquí.");
      } catch (error) {
        console.error("Error fetching lyrics:", error);
        if (isCurrent) setLyrics("ERROR_DE_ENLACE: No se pudo contactar al servidor de letras.\n\nPuedes ingresarlas manualmente.");
      }
    };

    if (activeTrack) {
      const savedLyrics = localStorage.getItem(`lyrics_${activeTrack}`);
      if (savedLyrics) {
        setLyrics(savedLyrics);
      } else {
        setLyrics("ESTABLECIENDO_CONEXION...\nBuscando letras en la red global...");
        fetchLyricsForTrack(activeTrack);
      }
    } else {
      setLyrics("");
    }

    return () => {
      isCurrent = false;
    };
  }, [deckA.track, deckB.track]);

  const handleLyricsChange = (e) => {
    const val = e.target.value;
    setLyrics(val);
    const activeTrack = deckA.track?.name || deckB.track?.name || "";
    if (activeTrack) {
      localStorage.setItem(`lyrics_${activeTrack}`, val);
    }
  };

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
    
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, width, height);
    
    const barWidth = (width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i] / 2;
      
      // Cyberpunk gradient: Cyan to Magenta
      const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
      gradient.addColorStop(0, '#00f0ff');
      gradient.addColorStop(1, '#ff2d7b');
      
      ctx.fillStyle = gradient;
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#00f0ff';
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      // Glitchy reflection
      ctx.fillStyle = 'rgba(255, 45, 123, 0.2)';
      ctx.fillRect(x, height - barHeight, barWidth, 1);
      
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

    // Waveform peak extraction
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const audioData = e.target.result;
        const decodedData = await audioCtxRef.current.decodeAudioData(audioData);
        const channelData = decodedData.getChannelData(0);
        const samples = 2000;
        const blockSize = Math.floor(channelData.length / samples);
        const peaks = [];
        for (let i = 0; i < samples; i++) {
          let min = 1.0;
          let max = -1.0;
          for (let j = 0; j < blockSize; j++) {
            const datum = channelData[i * blockSize + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
          }
          peaks.push(Math.max(Math.abs(min), Math.abs(max)));
        }
        setWaveformData(prev => ({ ...prev, [deckId]: peaks }));
      } catch (err) {
        console.error("Error decoding audio data", err);
      }
    };
    reader.readAsArrayBuffer(file);
    
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

  const parseLRC = (lrcString) => {
    if (!lrcString) return [];
    const lines = lrcString.split('\n');
    const parsed = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    
    for (let i = 0; i < lines.length; i++) {
      const match = timeRegex.exec(lines[i]);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const milliseconds = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
        const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
        const text = lines[i].replace(timeRegex, '').trim();
        if (text) {
          parsed.push({ time: timeInSeconds, text });
        }
      }
    }
    return parsed;
  };

  const LyricsPanel = () => {
    const parsedLyrics = React.useMemo(() => parseLRC(lyrics), [lyrics]);
    const isSynced = parsedLyrics.length > 0;
    const lyricsContainerRef = useRef(null);

    const activeDeckInfo = (deckA.track?.name && deckA.isPlaying) ? deckA : (deckB.track?.name && deckB.isPlaying) ? deckB : (deckA.track?.name ? deckA : deckB);
    const currentTime = activeDeckInfo.time || 0;

    const activeIndex = React.useMemo(() => {
      if (!isSynced) return -1;
      let idx = -1;
      for (let i = 0; i < parsedLyrics.length; i++) {
        if (currentTime >= parsedLyrics[i].time - 0.2) { // 200ms lead time for better sync feel
          idx = i;
        } else {
          break;
        }
      }
      return idx;
    }, [parsedLyrics, currentTime, isSynced]);

    useEffect(() => {
      if (isSynced && activeIndex !== -1 && lyricsContainerRef.current) {
        const container = lyricsContainerRef.current;
        const activeElem = container.children[activeIndex];
        if (activeElem) {
          const containerHeight = container.clientHeight;
          const elemTop = activeElem.offsetTop - container.offsetTop;
          const elemHeight = activeElem.clientHeight;
          
          container.scrollTo({
            top: elemTop - (containerHeight / 2) + (elemHeight / 2),
            behavior: 'smooth'
          });
        }
      }
    }, [activeIndex, isSynced]);

    return (
      <div className="winamp-panel p-4 rounded-lg flex flex-col h-full border-neon-cyan/50 shadow-[0_0_20px_rgba(0,240,255,0.15)] bg-black/80">
        <div className="flex justify-between items-center mb-3 border-b border-neon-cyan/30 pb-2">
          <h3 className="font-cyber text-neon-cyan text-sm tracking-widest flex items-center gap-2 glitch-text">
            <Search size={14} className="text-neon-cyan" /> DATAPAD_LETRAS // v2.0
          </h3>
          <button 
            onClick={() => { setLyrics(''); localStorage.removeItem(`lyrics_${deckA.track?.name || deckB.track?.name || ""}`); }}
            className="text-[9px] text-neon-magenta hover:text-black hover:bg-neon-magenta transition-all border border-neon-magenta/50 px-2 py-0.5 rounded shadow-[0_0_5px_#ff2d7b]"
          >
            FORZAR_PURGA
          </button>
        </div>
        
        {isSynced ? (
          <div 
            ref={lyricsContainerRef}
            className="w-full flex-1 h-[200px] overflow-y-auto bg-black/60 text-neon-cyan font-mono-retro p-4 rounded border border-neon-cyan/50 custom-scrollbar shadow-[inset_0_0_15px_rgba(0,240,255,0.2)]"
          >
            {parsedLyrics.map((line, idx) => {
              const isActive = idx === activeIndex;
              return (
                <div 
                  key={idx}
                  className={`py-3 text-center transition-all duration-300 ${
                    isActive 
                      ? 'text-neon-magenta text-xl md:text-2xl font-bold drop-shadow-[0_0_10px_#ff2d7b] scale-110 origin-center opacity-100' 
                      : 'text-neon-cyan/60 opacity-40 text-sm md:text-base'
                  }`}
                >
                  {line.text}
                </div>
              );
            })}
          </div>
        ) : (
          <textarea
            value={lyrics}
            onChange={handleLyricsChange}
            placeholder={deckA.track || deckB.track ? "PEGA O ESCRIBE LAS LETRAS AQUÍ..." : "CARGA UNA PISTA PARA AÑADIR LETRAS..."}
            className="w-full flex-1 min-h-[200px] bg-black/60 text-neon-cyan font-mono-retro text-sm p-4 rounded border border-neon-cyan/50 focus:border-neon-cyan outline-none resize-none custom-scrollbar shadow-[inset_0_0_15px_rgba(0,240,255,0.2)]"
          />
        )}
        
        <div className="mt-3 text-[10px] text-neon-cyan/60 font-mono-retro flex justify-between">
          <span>{isSynced ? '* MODO_KARAOKE: ACTIVO' : '* SINCRONIZANDO CON LOCAL_STORAGE'}</span>
          <span className="animate-pulse text-neon-yellow">ESTADO: OK</span>
        </div>
      </div>
    );
  };

  const DualWaveformDisplay = () => {
    const canvasARef = useRef(null);
    const canvasBRef = useRef(null);
    const reqRef = useRef(null);

    const draw = useCallback(() => {
      const drawWave = (canvas, peaks, deck, color) => {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        
        if (!peaks || peaks.length === 0) {
          ctx.fillStyle = color + '40';
          ctx.font = '10px "Share Tech Mono"';
          ctx.fillText('EXTRAYENDO_FRECUENCIAS...', 10, height / 2 + 3);
          return;
        }

        const progress = deck.duration ? deck.time / deck.duration : 0;
        const barWidth = 2;
        const gap = 1;
        const step = barWidth + gap;
        const totalWidth = peaks.length * step;
        
        const center = width / 2;
        const offset = center - (totalWidth * progress);

        ctx.fillStyle = color;
        ctx.shadowBlur = 4;
        ctx.shadowColor = color;
        
        for (let i = 0; i < peaks.length; i++) {
          const x = offset + (i * step);
          if (x > -barWidth && x < width) {
            const h = Math.max(1, peaks[i] * height * 0.9);
            ctx.fillRect(x, (height - h) / 2, barWidth, h);
          }
        }
        
        ctx.fillStyle = '#ff0000';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#ff0000';
        ctx.fillRect(center - 1, 0, 2, height);
      };

      drawWave(canvasARef.current, waveformData.A, deckA, '#00f0ff');
      drawWave(canvasBRef.current, waveformData.B, deckB, '#ff2d7b');
      reqRef.current = requestAnimationFrame(draw);
    }, [waveformData, deckA, deckB]);

    useEffect(() => {
      reqRef.current = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(reqRef.current);
    }, [draw]);

    return (
      <div className="w-full bg-cyber-dark/80 border border-neon-cyan/20 rounded-none mb-4 p-2 shadow-[0_0_20px_rgba(0,240,255,0.05)] flex flex-col gap-1">
        <div className="relative h-16 lg:h-20 w-full overflow-hidden bg-black/60 border border-neon-cyan/30">
          <div className="absolute top-1 left-2 text-[9px] font-cyber text-neon-cyan z-10 opacity-70">DECK_A // ONDA_FREQ</div>
          <canvas ref={canvasARef} width={1200} height={80} className="w-full h-full"></canvas>
        </div>
        <div className="relative h-16 lg:h-20 w-full overflow-hidden bg-black/60 border border-neon-magenta/30">
          <div className="absolute top-1 left-2 text-[9px] font-cyber text-neon-magenta z-10 opacity-70">DECK_B // ONDA_FREQ</div>
          <canvas ref={canvasBRef} width={1200} height={80} className="w-full h-full"></canvas>
        </div>
      </div>
    );
  };

  const Deck = ({ id, deckState }) => (
    <div className="flex-1 winamp-panel p-3 rounded-lg flex flex-col relative h-full w-full lg:w-auto overflow-hidden group">
      <div className="absolute top-0 left-0 w-full text-center text-[10px] text-neon-cyan bg-black/80 border-b border-neon-cyan/30 py-1 font-cyber tracking-widest z-10">
        DECK_{id} // ESTADO: {deckState.isPlaying ? 'ACTIVO' : 'INACTIVO'}
      </div>
      
      <div className="mt-7 bg-cyber-dark/80 p-3 rounded border border-neon-cyan/30 shadow-[0_0_15px_rgba(0,240,255,0.05)] flex flex-col gap-2 relative overflow-hidden">
        {/* Decorative corner */}
        <div className="absolute top-0 right-0 w-8 h-8 bg-neon-cyan/10 transform rotate-45 translate-x-4 -translate-y-4 border-b border-neon-cyan/30"></div>
        
        <div className="flex justify-between items-center mb-1">
           <div className="font-mono-retro text-xs lg:text-sm truncate text-neon-cyan shadow-neon-cyan/50 px-1 font-bold flex-1 mr-2 glitch-text">
             {deckState.track ? `${id}: ${deckState.track.name.replace(/\.[^/.]+$/, "")}` : `--- SIN_DATOS ---`}
           </div>
           <button 
             onClick={() => triggerLoad(id)} 
             className="retro-btn text-[9px] px-2 py-1 font-cyber font-bold flex items-center gap-1 shrink-0 border-neon-magenta/50 text-neon-magenta bg-transparent"
           >
             <Upload size={10} /> INYECTAR_PISTA
           </button>
        </div>
        
        <div className="flex justify-between items-end mb-1">
          <div className="text-3xl lg:text-4xl text-neon-magenta font-mono-retro font-bold tracking-widest" style={{ textShadow: '0 0 10px #ff2d7b' }}>
            {formatTime(deckState.time)}
          </div>
          <div className="text-right">
             <div className={`font-mono-retro text-[10px] lg:text-xs mb-1 ${deckState.isPlaying ? 'text-neon-cyan animate-pulse' : 'text-gray-600'}`}>
               {deckState.isPlaying ? '>> EJECUTANDO' : '|| DETENIDO'}
             </div>
             <div className="text-neon-yellow font-mono-retro text-[10px] lg:text-xs bg-neon-yellow/5 px-1 border border-neon-yellow/20 rounded">
               FRQ: {(deckState.pitch * 100).toFixed(0)}%
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
          />
        </div>
      </div>

      <div className="flex gap-4 mt-auto items-center justify-between pt-4">
        <div className="flex gap-2">
          <button 
            onClick={() => togglePlay(id)} 
            className={`retro-btn w-12 h-12 lg:w-16 lg:h-14 flex justify-center items-center ${deckState.isPlaying ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan shadow-[0_0_15px_#00f0ff]' : 'text-neon-cyan border-neon-cyan/30'}`}
          >
            {deckState.isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button onClick={() => stopDeck(id)} className="retro-btn w-12 h-12 lg:w-16 lg:h-14 flex justify-center items-center text-neon-magenta border-neon-magenta/30 hover:bg-neon-magenta/10">
            <Square size={20} fill="currentColor" />
          </button>
        </div>
        
        <div className="flex items-center gap-2 bg-black/40 p-2 rounded border border-white/5">
           <span className="text-[9px] text-neon-cyan font-cyber font-bold rotate-180 hidden lg:block" style={{writingMode: 'vertical-rl'}}>VELOC_SYNC</span>
           <span className="text-[9px] text-neon-cyan font-cyber font-bold lg:hidden">SYNC</span>
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
             className="text-[9px] bg-cyber-dark text-neon-yellow hover:bg-neon-yellow hover:text-black px-1 py-4 rounded border border-neon-yellow/30 font-cyber font-bold transition-all"
           >
             REINICIAR
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
          background: rgba(15, 15, 25, 0.85);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(0, 240, 255, 0.2);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.8), inset 0 0 32px 0 rgba(0, 240, 255, 0.05);
          position: relative;
          overflow: hidden;
        }
        .winamp-panel::before {
          content: "";
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
          transition: 0.5s;
          pointer-events: none;
        }
        .winamp-panel:hover::before {
          left: 100%;
        }
        .retro-text {
          font-family: 'Share Tech Mono', monospace;
          color: #00f0ff;
          text-shadow: 0 0 5px rgba(0, 240, 255, 0.5);
        }
        .retro-btn {
          background: transparent;
          color: #00f0ff;
          border: 1px solid rgba(0, 240, 255, 0.3);
          border-radius: 4px;
          transition: all 0.2s ease;
          cursor: pointer;
          font-family: 'Orbitron', sans-serif;
          position: relative;
          overflow: hidden;
        }
        .retro-btn::after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(0, 240, 255, 0.1);
          opacity: 0;
          transition: 0.2s;
        }
        .retro-btn:hover {
          border-color: #00f0ff;
          box-shadow: 0 0 10px rgba(0, 240, 255, 0.4);
          transform: translateY(-1px);
        }
        .retro-btn:hover::after {
          opacity: 1;
        }
        .retro-btn:active {
          transform: translateY(1px);
        }
        .retro-btn.active-mode {
          background-color: rgba(255, 45, 123, 0.2);
          border-color: #ff2d7b;
          color: #ff2d7b;
          box-shadow: 0 0 15px rgba(255, 45, 123, 0.5);
        }
        .eq-slider {
          -webkit-appearance: none; background: transparent; height: 8px; transform: rotate(-90deg); transform-origin: center;
        }
        .eq-slider::-webkit-slider-runnable-track {
          width: 100%; height: 4px; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(0, 240, 255, 0.2); border-radius: 2px;
        }
        .eq-slider::-webkit-slider-thumb {
          -webkit-appearance: none; height: 20px; width: 12px; border-radius: 2px;
          background: #ff2d7b; border: 1px solid #fff;
          margin-top: -9px; cursor: pointer; box-shadow: 0 0 10px #ff2d7b;
        }
        .normal-slider {
          -webkit-appearance: none; width: 100%; height: 6px; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(0, 240, 255, 0.2); border-radius: 3px;
        }
        .normal-slider::-webkit-slider-thumb {
          -webkit-appearance: none; height: 20px; width: 12px; background: #00f0ff;
          border: 1px solid #fff;
          border-radius: 2px; cursor: pointer; box-shadow: 0 0 10px #00f0ff;
        }
        .progress-slider {
          -webkit-appearance: none; width: 100%; height: 16px; background: transparent; cursor: pointer; position: relative;
        }
        .progress-slider::-webkit-slider-runnable-track {
          width: 100%; height: 4px; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 3px;
        }
        .progress-slider::-webkit-slider-thumb {
          -webkit-appearance: none; height: 14px; width: 8px; background: #ff2d7b; border-radius: 1px;
          box-shadow: 0 0 10px #ff2d7b; margin-top: -6px; border: 1px solid #fff;
        }
        .progress-slider:disabled {
          opacity: 0.1; cursor: not-allowed;
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
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-black text-neon-cyan font-cyber px-6 py-3 text-sm lg:text-base rounded-none z-[2000] shadow-[0_0_20px_#00f0ff] border border-neon-cyan whitespace-nowrap animate-glitch">
          <span className="mr-2">MENSAJE_SISTEMA ::</span> {uiMessage}
        </div>
      )}

      <div className="scanlines"></div>

      {/* Main Content Area */}
      <div className="bg-cyber-dark/40 backdrop-blur-md w-full p-3 lg:p-6 rounded-none border-x border-neon-cyan/20 shadow-2xl flex flex-col lg:flex-row gap-6 mx-auto max-w-[1500px] relative z-10 my-4 lg:my-8 border-t border-b border-t-neon-magenta/30 border-b-neon-magenta/30">
        
        {/* LEFT COLUMN: Main Controls */}
        <div className="flex-1 flex flex-col gap-4 w-full">
        {/* Header Responsivo */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-3 w-full border-b border-white/5 pb-4">
          <div className="flex items-center gap-2 lg:gap-3">
             <Disc3 className="text-neon-cyan shrink-0 animate-spin-slow" size={28} />
             <div className="text-neon-cyan font-cyber font-bold tracking-[0.2em] text-sm lg:text-xl text-center md:text-left glitch-text">
               AUDIOFORUM // CYBER_STATION_v2
             </div>
          </div>
          <button 
            onClick={toggleRecording}
            className={`flex items-center justify-center gap-2 px-6 py-2 w-full md:w-auto font-cyber text-xs tracking-widest transition-all border outline-none
              ${isRecording ? 'bg-neon-magenta text-white border-white animate-flicker shadow-[0_0_15px_#ff2d7b]' : 'bg-transparent text-neon-yellow border-neon-yellow/50 hover:bg-neon-yellow/10 hover:border-neon-yellow'}`}
          >
            {isRecording ? <StopCircle size={18} fill="currentColor" /> : <Mic size={18} />}
            <span className="text-sm lg:text-base">{isRecording ? 'GRABANDO_STREAM...' : 'INICIAR_CAPTURA'}</span>
          </button>
        </div>

        <DualWaveformDisplay />

        {/* TOP ROW: Deck A | Center Mixer/Disc | Deck B */}
        <div className="flex flex-col lg:flex-row gap-4 h-auto lg:h-[360px] w-full">
          <Deck id="A" deckState={deckA} />

          {/* CENTRAL MIXER & DISC */}
          <div className="winamp-panel p-3 rounded-lg flex flex-col relative w-full lg:w-[340px] shrink-0 items-center justify-between min-h-[300px] lg:min-h-0 border-neon-magenta/20">
            <div className="absolute top-0 left-0 w-full text-center text-[10px] text-neon-magenta bg-black/80 border-b border-neon-magenta/30 py-1 font-cyber tracking-widest z-10">
              PROCESADOR_CENTRAL // MASTER
            </div>

            <div className="mt-7 w-full max-w-[280px] bg-cyber-dark/80 p-1 rounded border border-neon-cyan/20 h-10 mb-2 overflow-hidden">
              <canvas ref={canvasRef} width="280" height="30" className="w-full h-full bg-black/40 rounded opacity-90"></canvas>
            </div>

            <div 
              onMouseDown={handleScrubStart}
              onTouchStart={handleScrubStart}
              className={`relative flex justify-center items-center h-28 w-28 lg:h-36 lg:w-36 shrink-0 aspect-square rounded-full border-[2px] border-neon-cyan/30 bg-black shadow-[0_0_20px_rgba(0,240,255,0.1)] my-2 cursor-grab select-none touch-none overflow-hidden ${isScrubbing ? 'cursor-grabbing border-neon-cyan shadow-[0_0_30px_#00f0ff]' : ''}`}
              style={{ 
                animation: (deckA.isPlaying || deckB.isPlaying || playlistPlayer.isPlaying) && !isScrubbing ? 'custom-spin 3s linear infinite' : 'none',
                transform: isScrubbing ? 'scale(0.98)' : 'scale(1)',
                transition: 'all 0.2s ease'
              }}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(0,240,255,0.1)_0%,transparent_70%)]"></div>
              <div className="absolute inset-1 rounded-full border border-white/5"></div>
              <div className="absolute inset-4 rounded-full border border-neon-cyan/10"></div>
              <div className="absolute inset-8 rounded-full border border-white/5"></div>
              <div className="absolute inset-12 rounded-full border border-neon-cyan/10"></div>
              
              <div className="absolute h-10 w-10 lg:h-12 lg:w-12 rounded-full bg-black border border-neon-cyan flex items-center justify-center shadow-[0_0_15px_#00f0ff] z-20">
                 <div className="text-[5px] font-cyber text-neon-cyan absolute top-1.5 tracking-widest animate-pulse">SYSTEM_C</div>
                 <div className="h-3 w-3 rounded-full bg-neon-cyan shadow-[0_0_10px_#00f0ff]"></div>
              </div>
            </div>

            <div className="w-full flex flex-col gap-2 mt-auto">
              <div className="bg-black/60 border border-neon-magenta/20 rounded-none flex justify-between items-center px-2 lg:px-4 py-3">
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
                     <span className="text-[8px] text-neon-magenta mt-3 font-cyber font-bold opacity-70">{label}</span>
                   </div>
                 )})}
              </div>

              <div className="bg-black/40 p-3 rounded-none border border-white/5 flex flex-col gap-4">
                 <div className="flex items-center gap-3">
                    <Volume2 size={16} className="text-neon-cyan" />
                    <input 
                      type="range" min="0" max="1" step="0.01" 
                      value={masterVolume} onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                      className="normal-slider flex-1"
                    />
                 </div>
                 <div className="flex flex-col">
                   <div className="flex justify-between text-[10px] font-cyber font-bold text-neon-cyan mb-1 tracking-tighter opacity-70">
                     <span>DECK_A</span>
                     <span>MEZCLADOR_V1</span>
                     <span>DECK_B</span>
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
        <div className="winamp-panel p-3 rounded-lg w-full flex flex-col relative mt-2 border-neon-cyan/20">
           <div className="absolute top-0 left-0 w-full text-center text-[10px] text-neon-cyan bg-black/80 border-b border-neon-cyan/30 py-1 font-cyber tracking-widest z-10 flex justify-center items-center gap-4">
              <span className="animate-pulse">●</span> MÓDULO_FX_ANALÓGICO // SOBRECARGA_PERMITIDA <span className="animate-pulse">●</span>
           </div>

           <div className="mt-8 flex flex-col lg:flex-row gap-4 w-full h-full">
              {/* Controles FX DECK A */}
              <div className="flex-1 bg-cyber-dark/60 border border-neon-cyan/10 rounded-none p-4 flex flex-col items-center transition-all hover:bg-neon-cyan/5">
                 <span className="text-neon-cyan font-cyber font-bold text-[10px] tracking-[0.3em] mb-4 opacity-70">DECK_A // PROCESADOR</span>
                 <div className="flex flex-wrap sm:flex-nowrap gap-3 w-full justify-center">
                    <button 
                      onClick={() => setModeA('normal')}
                      className={`retro-btn text-[9px] px-3 py-3 font-cyber tracking-widest flex-1 min-w-[80px] ${modeA === 'normal' ? 'active-mode' : ''}`}
                    >
                      PLANO_O
                    </button>
                    <button 
                      onClick={() => setModeA('echo')}
                      className={`retro-btn text-[9px] px-3 py-3 font-cyber tracking-widest flex-1 min-w-[80px] ${modeA === 'echo' ? 'active-mode' : ''}`}
                    >
                      ECO_S
                    </button>
                    <button 
                      onClick={() => setModeA('radio')}
                      className={`retro-btn text-[9px] px-3 py-3 font-cyber tracking-widest flex-1 min-w-[80px] ${modeA === 'radio' ? 'active-mode' : ''}`}
                    >
                      RADIO_R
                    </button>
                 </div>
              </div>

              {/* Separador Central para PC */}
              <div className="w-full lg:w-1 h-1 lg:h-auto bg-gray-800 rounded"></div>

              {/* Controles FX DECK B */}
              <div className="flex-1 bg-cyber-dark/60 border border-neon-magenta/10 rounded-none p-4 flex flex-col items-center transition-all hover:bg-neon-magenta/5">
                 <span className="text-neon-magenta font-cyber font-bold text-[10px] tracking-[0.3em] mb-4 opacity-70">DECK_B // PROCESADOR</span>
                 <div className="flex flex-wrap sm:flex-nowrap gap-3 w-full justify-center">
                    <button 
                      onClick={() => setModeB('normal')}
                      className={`retro-btn text-[9px] px-3 py-3 font-cyber tracking-widest flex-1 min-w-[80px] ${modeB === 'normal' ? 'active-mode' : ''}`}
                    >
                      PLANO_O
                    </button>
                    <button 
                      onClick={() => setModeB('echo')}
                      className={`retro-btn text-[9px] px-3 py-3 font-cyber tracking-widest flex-1 min-w-[80px] ${modeB === 'echo' ? 'active-mode' : ''}`}
                    >
                      ECO_S
                    </button>
                    <button 
                      onClick={() => setModeB('radio')}
                      className={`retro-btn text-[9px] px-3 py-3 font-cyber tracking-widest flex-1 min-w-[80px] ${modeB === 'radio' ? 'active-mode' : ''}`}
                    >
                      RADIO_R
                    </button>
                 </div>
              </div>
           </div>
           
        </div>

        {/* LIBRERÍA DE PISTAS LOCAL (PLAYLIST) */}
        <div className="winamp-panel p-2 rounded-lg w-full flex flex-col min-h-[300px] border-neon-cyan/10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-black/60 p-3 mb-2 border border-white/5 rounded-none gap-3">
            <span className="font-cyber text-[10px] text-neon-cyan font-bold ml-1 lg:ml-2 tracking-[0.2em] flex items-center gap-3 whitespace-nowrap">
               <FolderOpen size={16} className="text-neon-cyan"/> ALMACÉN_NUBE // REPOSITORIO
            </span>

            {/* MINIREPRODUCTOR DE LA LISTA */}
            <div className="flex items-center bg-cyber-dark border border-neon-cyan/20 rounded px-3 gap-3 h-10 shadow-[inset_0_0_10px_rgba(0,240,255,0.05)]">
              <button onClick={playPlaylistPrev} className="text-neon-cyan/50 hover:text-neon-cyan transition-colors"><SkipBack size={16} /></button>
              <button 
                 onClick={togglePlaylistPlay} 
                 className={`font-cyber flex items-center gap-1 transition-all ${playlistPlayer.isPlaying ? 'text-neon-magenta shadow-[0_0_10px_#ff2d7b]' : 'text-neon-cyan/50 hover:text-neon-cyan'}`}
              >
                {playlistPlayer.isPlaying ? <Pause size={16} /> : <Play size={16} />}
                <span className="text-[9px] tracking-[0.2em] ml-2">REPRODUCIR_SEQ</span>
              </button>
              <button onClick={playPlaylistNext} className="text-neon-cyan/50 hover:text-neon-cyan transition-colors"><SkipForward size={16} /></button>
            </div>
            
            <div className="flex-1 flex flex-col sm:flex-row items-center gap-3 w-full justify-end">
               <div className="flex-1 flex items-center bg-black/40 border border-white/10 rounded-none px-3 w-full max-w-[300px] focus-within:border-neon-cyan transition-all">
                  <Search size={14} className="text-neon-cyan" />
                  <input 
                    type="text" 
                    placeholder="BUSCAR_EN_BASE_DATOS..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent text-[11px] text-neon-cyan font-mono-retro outline-none p-2 w-full placeholder-neon-cyan/20"
                  />
               </div>

               <div className="flex gap-2 w-full sm:w-auto">
                 <button 
                   onClick={clearEntirePlaylist}
                   className="retro-btn text-[10px] px-3 py-2 lg:py-1.5 font-cyber w-full sm:w-auto whitespace-nowrap text-neon-magenta border-neon-magenta/40 hover:bg-neon-magenta/20"
                   title="Wipe data"
                 >
                   LIMPIAR_TODO
                 </button>
                 <button 
                   onClick={() => playlistInputRef.current?.click()}
                   className="retro-btn text-[10px] px-4 py-2 lg:py-1.5 font-cyber w-full sm:w-auto whitespace-nowrap bg-neon-cyan/10 text-neon-cyan border-neon-cyan/50 hover:bg-neon-cyan/30"
                 >
                   + AÑADIR_PISTAS
                 </button>
               </div>
            </div>
          </div>
          
          <div className="flex-1 bg-black/40 border border-white/5 rounded-none overflow-y-auto p-4 custom-scrollbar">
            {files.length === 0 ? (
              <div className="font-mono-retro text-xs opacity-50 text-center mt-6 flex flex-col items-center gap-4 p-8 text-neon-cyan">
                <Disc3 size={40} className="animate-spin-slow" />
                BASE_DATOS_VACÍA :: ESPERANDO_PISTAS...<br/>USA '+ AÑADIR_PISTAS' PARA LLENAR EL REPOSITORIO.
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="font-mono-retro text-xs opacity-50 text-center mt-6 flex flex-col items-center gap-4 p-8 text-neon-magenta">
                <Search size={40} />
                NO_HAY_COINCIDENCIAS: "{searchQuery}"
              </div>
            ) : (
              <ul className="space-y-1">
                {filteredFiles.map((file, index) => {
                  const originalIndex = files.indexOf(file);
                  const isCurrentlyPlaying = playlistPlayer.isPlaying && playlistPlayer.currentIndex === originalIndex;
                  return (
                  <li key={`${file.name}-${file.size}-${index}`} 
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 hover:bg-neon-cyan/5 border-b border-white/5 group gap-3 sm:gap-0 transition-all
                                  ${isCurrentlyPlaying ? 'bg-neon-cyan/10 border-l-2 border-l-neon-cyan shadow-[inset_10px_0_15px_-10px_rgba(0,240,255,0.3)]' : 'border-l-2 border-l-transparent'}`}>
                    
                    <div className="flex items-center flex-1 w-full sm:w-auto truncate overflow-hidden">
                      {/* Botón para reproducir ESTA canción en el AutoPlay */}
                      <button 
                        onClick={() => playPlaylistTrack(originalIndex)}
                        className={`mr-4 p-2 rounded-none transition-all border ${isCurrentlyPlaying ? 'bg-neon-cyan text-black border-white shadow-[0_0_15px_#00f0ff]' : 'bg-black/80 text-neon-cyan/60 border-neon-cyan/30 hover:bg-neon-cyan hover:text-black hover:border-white'}`}
                        title="Execute from here"
                      >
                         {isCurrentlyPlaying ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor" className="ml-0.5" />}
                      </button>
                      
                      <span className={`font-mono-retro text-xs lg:text-sm truncate font-bold tracking-wider ${isCurrentlyPlaying ? 'text-neon-cyan' : 'text-gray-400 group-hover:text-neon-cyan/80'}`}>
                        {originalIndex + 1}. {file.name.replace(/\.[^/.]+$/, "")}
                      </span>
                    </div>

                    <div className="flex gap-3 w-full sm:w-auto px-1 items-center justify-end">
                      <button 
                        onClick={() => loadTrackToDeck(file, 'A')}
                        className="retro-btn flex-1 sm:flex-none text-[9px] lg:text-[10px] px-3 lg:px-4 py-2 font-cyber tracking-widest border-neon-cyan/40"
                      >
                        CARGAR_A
                      </button>
                      <button 
                        onClick={() => loadTrackToDeck(file, 'B')}
                        className="retro-btn flex-1 sm:flex-none text-[9px] lg:text-[10px] px-3 lg:px-4 py-2 font-cyber tracking-widest border-neon-cyan/40"
                      >
                        CARGAR_B
                      </button>
                      <button
                        onClick={() => removeTrackFromPlaylist(file)}
                        className="p-2 rounded-none bg-transparent hover:bg-neon-magenta/20 text-neon-magenta/50 hover:text-neon-magenta border border-neon-magenta/20 transition-all ml-1 shadow-[inset_0_0_10px_rgba(255,45,123,0.05)]"
                        title="Purge record"
                      >
                         <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                )})}
              </ul>
            )}
          </div>
          
          <div className="mt-3 flex justify-end gap-2">
             <div className="bg-black/60 border border-neon-cyan/20 px-3 py-1 font-mono-retro text-[9px] text-neon-cyan flex items-center font-bold tracking-widest">
                {searchQuery ? `ENCONTRADAS://${filteredFiles.length} // TOTAL://${files.length}` : `TOTAL_PISTAS://${files.length}`}
             </div>
          </div>
        </div>
        </div> {/* End of LEFT COLUMN */}

        {/* RIGHT COLUMN: Lyrics Panel */}
        <div className="w-full lg:w-[350px] shrink-0 flex flex-col h-[500px] lg:h-auto">
           <LyricsPanel />
        </div>

      </div>
    </div>
  );
};

export default App;