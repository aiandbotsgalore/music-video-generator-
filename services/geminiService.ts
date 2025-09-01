

import { GoogleGenAI, Type } from "@google/genai";
import type { EditDecision, AudioAnalysis, ClipMetadata } from "../types";

let ai: GoogleGenAI | null = null;

// This function lazily initializes the GoogleGenAI client,
// preventing the app from crashing on load if the API key is missing.
const getGenAI = (): GoogleGenAI => {
    if (ai) {
        return ai;
    }

    const API_KEY = process.env.API_KEY;
    if (!API_KEY) {
      throw new Error("API_KEY environment variable not set. Please configure your API key.");
    }

    ai = new GoogleGenAI({ apiKey: API_KEY });
    return ai;
}

const model = 'gemini-2.5-flash';

// Helper function to convert a File to a base64 string
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // remove 'data:*/*;base64,' prefix
            const base64 = result.split(',')[1];
            if (!base64) {
                reject(new Error("Failed to read file as base64."));
            } else {
                resolve(base64);
            }
        };
        reader.onerror = error => reject(error);
    });
};

export const describeMusic = async (audioFile: File): Promise<string> => {
    const genAI = getGenAI();
    const base64Audio = await fileToBase64(audioFile);
    
    const audioPart = {
        inlineData: {
            mimeType: audioFile.type,
            data: base64Audio,
        },
    };

    const prompt = `Analyze this audio file and provide a concise, evocative description of its mood, genre, and tempo. This description will be used to guide the creation of a music video. Keep it to one sentence. Example: "Energetic hyper-pop with a fast beat, perfect for quick cuts and flashy visuals."`;

    try {
        const response = await genAI.models.generateContent({
            model: model,
            contents: {
                parts: [
                    { text: prompt },
                    audioPart
                ]
            }
        });
        
        const text = response.text.trim();
        if (!text) {
            throw new Error("AI returned an empty description. Please try again or describe the music manually.");
        }
        return text;
    } catch (error) {
        console.error("Error calling Gemini API for audio description:", error);
        throw new Error("Failed to get an AI description for the audio. The model might be temporarily unavailable or the file could not be processed. You can describe the vibe manually.");
    }
};

const responseSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            clipIndex: {
                type: Type.INTEGER,
                description: 'The 0-based index of the video clip to use from the provided clips.'
            },
            duration: {
                type: Type.NUMBER,
                description: 'How long this clip should play, in seconds.'
            },
            description: {
                type: Type.STRING,
                description: 'A brief, exciting description of why this clip was chosen for this moment, referencing the audio and visual content.'
            }
        },
        required: ["clipIndex", "duration", "description"]
    }
};


const generateContentAwarePrompt = (
    musicDescription: string,
    audioAnalysis: AudioAnalysis,
    clips: ClipMetadata[]
): string => {
    const visualSummary = clips.map((clip, index) => {
        if (!clip.analysis) return `Clip ${index} (${clip.name}): [Analysis not available]`;
        const { dominantCategory, hasFaces, motionLevel, avgBrightness, visualComplexity } = clip.analysis;
        return `Clip ${index} (${clip.name}): [Content: ${dominantCategory}] [Faces: ${hasFaces ? 'Yes' : 'No'}] [Motion: ${motionLevel}] [Brightness: ${avgBrightness.toFixed(2)}] [Complexity: ${visualComplexity.toFixed(2)}]`;
    }).join('\n');

    const energySummary = audioAnalysis.energySegments.map(s => `From ${s.startTime.toFixed(1)}s to ${s.endTime.toFixed(1)}s the energy is ${s.intensity}.`).join(' ');

    return `
You are an expert music video editor with advanced content analysis capabilities. Your task is to create a compelling music video sequence by matching visuals to audio intelligently.

OVERALL CREATIVE BRIEF:
- Music Vibe: "${musicDescription}"
- Target Duration: Approximately ${audioAnalysis.duration.toFixed(1)} seconds.

DETAILED AUDIO ANALYSIS:
- Tempo: ${audioAnalysis.bpm.toFixed(0)} BPM. This suggests the rhythm for your cuts.
- Energy Profile: ${energySummary} Match the visual intensity to these energy levels.

VISUAL CLIP LIBRARY (${clips.length} clips available):
${visualSummary}

CONTENT-AWARE EDITING RULES:
1.  Match Motion to Energy: Use 'high' motion clips for 'high' energy sections. Use 'static' or 'low' motion clips for 'low' energy sections.
2.  Match Mood with Light: Use high brightness clips for upbeat, happy sections. Use low brightness clips for moody, atmospheric parts.
3.  Pacing with Complexity: Use high complexity (busy) clips for crescendos or chaotic moments. Use low complexity (simple) clips for calm, focused moments.
4.  Prioritize People: If the vibe suggests vocals or emotion, prioritize using clips with faces.
5.  Synchronize to BPM: Make your cut durations rhythmically consistent with the ${audioAnalysis.bpm.toFixed(0)} BPM tempo. Durations should ideally be multiples or fractions of the beat duration.
6.  Vary Your Shots: Create a dynamic experience by using a good variety of the available clips.
7.  Total Duration: The sum of all clip durations MUST be very close to the target duration of ${audioAnalysis.duration.toFixed(1)} seconds.

INSTRUCTIONS:
Generate a JSON array of edit decisions based on the analysis and rules above. The 'clipIndex' must be a valid 0-based index from the Visual Clip Library (an integer from 0 to ${clips.length - 1}). The 'description' should explain your creative choice, linking the visual to the music's properties.
`;
};


export const createVideoSequence = async (
  musicDescription: string,
  audioAnalysis: AudioAnalysis,
  clips: ClipMetadata[],
): Promise<EditDecision[]> => {
    
  const genAI = getGenAI();
  const prompt = generateContentAwarePrompt(musicDescription, audioAnalysis, clips);
  
  const imageParts = clips.map(clip => ({
      inlineData: {
          mimeType: 'image/jpeg',
          data: clip.thumbnail,
      }
  }));

  try {
    const response = await genAI.models.generateContent({
        model: model,
        contents: {
            parts: [
                { text: prompt },
                ...imageParts
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 1024 },
        }
    });

    const text = response.text.trim();
    let parsedJson;
    try {
        parsedJson = JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse Gemini response as JSON:", text);
        throw new Error("The AI returned a response in an unexpected format. This is often a temporary issue, please try generating again.");
    }
    
    // Handle cases where the model returns a single object instead of an array
    if (!Array.isArray(parsedJson)) {
        if (typeof parsedJson === 'object' && parsedJson !== null && 'clipIndex' in parsedJson) {
            parsedJson = [parsedJson];
        } else {
             throw new Error("AI response is not a valid array of edit decisions.");
        }
    }
    
    // Repair and validate the AI's response to be more resilient
    const repairedAndValidatedDecisions: EditDecision[] = parsedJson
        .map((item: any) => {
            // Check for basic structural validity
            if (typeof item?.clipIndex !== 'number' || typeof item?.duration !== 'number' || item.duration <= 0 || typeof item?.description !== 'string') {
                return null; // Invalid structure, will be filtered out
            }

            // Repair step: use modulo to ensure clipIndex is always in a valid range.
            // This prevents errors if the AI hallucinates an out-of-bounds index.
            const repairedIndex = Math.abs(item.clipIndex) % clips.length;

            return {
                clipIndex: repairedIndex,
                duration: item.duration,
                description: item.description,
            };
        })
        .filter((item): item is EditDecision => item !== null); // Filter out any malformed items


    if (repairedAndValidatedDecisions.length === 0) {
        throw new Error("The AI failed to generate a valid video sequence. Please try again with different clips or a clearer description.");
    }
    
    return repairedAndValidatedDecisions;

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error && error.message.includes("SAFETY")) {
        throw new Error("The request was blocked due to safety policies. Please try different clips or a different description.")
    }
    // Re-throw specific, user-friendly errors if they were already set
    if (error instanceof Error && (error.message.includes("unexpected format") || error.message.includes("valid video sequence"))) {
        throw error;
    }
    throw new Error("The AI was unable to create a video sequence. This could be due to a temporary network issue or an internal error. Please try again.");
  }
};