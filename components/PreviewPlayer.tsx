
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { GeneratedVideo } from '../types';
import { exportVideo } from '../services/videoExportService';
import { PlayIcon } from './icons/PlayIcon';
import { PauseIcon } from './icons/PauseIcon';
import { ReplayIcon } from './icons/ReplayIcon';
import { VolumeUpIcon } from './icons/VolumeUpIcon';
import { VolumeOffIcon } from './icons/VolumeOffIcon';

interface PreviewPlayerProps {
  generatedVideo: GeneratedVideo;
  onRestart: () => void;
}

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const PreviewPlayer: React.FC<PreviewPlayerProps> = ({ generatedVideo, onRestart }) => {
  const { audioFile, videoFiles, editDecisionList } = generatedVideo;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderMessage, setRenderMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [activeClipDescription, setActiveClipDescription] = useState('Video Preview');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(-1);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentClipIndexRef = useRef<number | null>(null);

  const audioUrl = useMemo(() => URL.createObjectURL(audioFile), [audioFile]);
  const videoUrls = useMemo(() => videoFiles.map(file => URL.createObjectURL(file)), [videoFiles]);

  const clipSegments = useMemo(() => {
    let accumulatedTime = 0;
    return editDecisionList.map(decision => {
        const startTime = accumulatedTime;
        accumulatedTime += decision.duration;
        return { ...decision, startTime, endTime: accumulatedTime };
    });
  }, [editDecisionList]);
  
  useEffect(() => {
    return () => {
        URL.revokeObjectURL(audioUrl);
        videoUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [audioUrl, videoUrls]);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;

    const handleLoadedMetadata = () => {
        if (!isNaN(audio.duration)) {
           setDuration(audio.duration);
        }
    };

    const syncVideo = (time: number) => {
        const currentSegment = clipSegments.find(
            (segment) => time >= segment.startTime && time < segment.endTime
        );

        const segmentIndex = currentSegment ? clipSegments.indexOf(currentSegment) : -1;
        setActiveSegmentIndex(segmentIndex);

        if (currentSegment) {
            setActiveClipDescription(`Clip ${currentSegment.clipIndex + 1}: "${currentSegment.description}"`);
            const clipFileIndex = currentSegment.clipIndex;

            if (clipFileIndex !== currentClipIndexRef.current && clipFileIndex >= 0 && clipFileIndex < videoUrls.length) {
                video.src = videoUrls[clipFileIndex];
                currentClipIndexRef.current = clipFileIndex;
            }
            
            if (currentClipIndexRef.current !== null) {
                const timeInClip = time - currentSegment.startTime;
                if (Math.abs(video.currentTime - timeInClip) > 0.25) {
                    video.currentTime = timeInClip;
                }
            }
        }
    };
    
    const handleTimeUpdate = () => {
        const now = audio.currentTime;
        setCurrentTime(now);
        syncVideo(now);
    };

    const onPlay = () => { video.play().catch(e => console.error("Video play failed:", e)); setIsPlaying(true); };
    const onPause = () => { video.pause(); setIsPlaying(false); };
    const onEnded = () => { video.pause(); setIsPlaying(false); setIsFinished(true); };
    const onSeeking = () => syncVideo(audio.currentTime);

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("seeking", onSeeking);

    if (audio.readyState >= 1) handleLoadedMetadata();
    syncVideo(audio.currentTime);
    
    return () => {
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        audio.removeEventListener("timeupdate", handleTimeUpdate);
        audio.removeEventListener("play", onPlay);
        audio.removeEventListener("pause", onPause);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("seeking", onSeeking);
    };
  }, [clipSegments, videoUrls]);
  
  useEffect(() => {
      if (audioRef.current) {
          audioRef.current.volume = isMuted ? 0 : volume;
      }
  }, [volume, isMuted]);

  const handlePlayPause = () => {
    if (isFinished) {
      if(audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play();
          setIsFinished(false);
      }
    } else {
        if (isPlaying) {
            audioRef.current?.pause();
        } else {
            audioRef.current?.play();
        }
    }
  };

  const handleDownload = async () => {
      setIsRendering(true);
      setRenderProgress(0);
      setRenderMessage("Starting video export...");
      try {
          await exportVideo(generatedVideo, (progress, message) => {
              setRenderProgress(progress);
              setRenderMessage(message);
          });
      } catch (err) {
          console.error("Failed to export video:", err);
          setRenderMessage(`Export Failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`);
          setTimeout(() => setIsRendering(false), 5000);
          return;
      }
      setIsRendering(false);
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || duration === 0) return;
    const timeline = e.currentTarget;
    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    audioRef.current.currentTime = percentage * duration;
  };

  return (
    <div className="w-full flex flex-col items-center animate-fade-in">
        <h2 className="text-3xl font-bold mb-4">Your Vision, Realized</h2>
        <p className="text-gray-400 mb-6 text-center">Press play to watch your AI-generated music video.</p>
        
        <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative shadow-lg shadow-brand-cyan/20 group">
            <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
            />
             <audio ref={audioRef} src={audioUrl}></audio>
             {isRendering && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-30 transition-opacity">
                    <h3 className="text-2xl font-bold text-white mb-4">{renderMessage}</h3>
                    <div className="w-3/4 bg-gray-600 rounded-full h-4">
                        <div className="bg-brand-cyan h-4 rounded-full transition-all duration-500" style={{width: `${renderProgress * 100}%`}}></div>
                    </div>
                    <p className="mt-2 text-brand-cyan">{Math.round(renderProgress * 100)}% complete</p>
                </div>
             )}
             <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <p className="font-semibold text-white truncate" title={activeClipDescription}>
                    {activeClipDescription}
                </p>
             </div>
             <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-100 group-hover:opacity-100 transition-opacity z-10">
                <button
                    onClick={handlePlayPause}
                    className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white transform transition-transform hover:scale-110"
                    aria-label={isPlaying ? "Pause" : "Play"}
                >
                    {isFinished ? <ReplayIcon className="w-10 h-10" /> : (isPlaying ? <PauseIcon className="w-10 h-10" /> : <PlayIcon className="w-10 h-10 ml-1" />)}
                </button>
             </div>
        </div>
        <div className="w-full mt-4 flex items-center gap-4 px-1">
            <div className="text-sm text-gray-400">{formatTime(currentTime)}</div>
            <div onClick={handleSeek} className="relative flex-grow h-2 bg-gray-700 rounded-full group cursor-pointer">
                <div className="absolute h-full bg-brand-pink rounded-full" style={{width: `${(currentTime / duration) * 100}%`}}></div>
                <div className="absolute h-full w-full flex">
                    {clipSegments.map((clip, index) => (
                         <div key={index} className={`h-full border-r-2 border-gray-900/50 ${activeSegmentIndex === index ? 'bg-brand-cyan/50' : 'bg-transparent'}`} style={{width: `${(clip.duration / duration) * 100}%`}}></div>
                    ))}
                </div>
            </div>
            <div className="text-sm text-gray-400">{formatTime(duration)}</div>
            <div className="flex items-center gap-2">
                <button onClick={() => setIsMuted(!isMuted)} aria-label={isMuted ? "Unmute" : "Mute"}>
                    {isMuted || volume === 0 ? <VolumeOffIcon className="w-6 h-6 text-gray-400" /> : <VolumeUpIcon className="w-6 h-6 text-gray-400" />}
                </button>
                <input 
                    type="range" 
                    min="0" max="1" step="0.05" 
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                        setVolume(parseFloat(e.target.value));
                        if(isMuted) setIsMuted(false);
                    }}
                    className="w-20 h-1 accent-brand-cyan"
                />
            </div>
        </div>
        
        <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full max-w-md">
            <button
                onClick={onRestart}
                className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all"
            >
                Create New Video
            </button>
             <button
                onClick={handleDownload}
                disabled={isRendering}
                className="w-full bg-brand-cyan text-gray-900 font-bold py-3 px-4 rounded-lg transition-all disabled:bg-brand-cyan/50 disabled:cursor-not-allowed"
            >
                {isRendering ? 'Rendering...' : 'Download Video'}
            </button>
        </div>
    </div>
  );
};

export default PreviewPlayer;
