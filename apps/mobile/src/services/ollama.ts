import axios from 'axios';
import { z } from 'zod';

// Validation schemas (shared with desktop app)
export const LessonSchema = z.object({
  title: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    content: z.string()
  })),
  glossary: z.array(z.object({
    term: z.string(),
    definition: z.string()
  })).optional()
});

export type Lesson = z.infer<typeof LessonSchema>;

// Ollama API types
interface OllamaChatMessage {
  role: string;
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message: OllamaChatMessage;
  done: boolean;
}

// Configuration
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3:8b';

// Get Ollama URL from environment or use default
const getOllamaUrl = (): string => {
  // In Expo, we use app.json constants or manual config
  // For local development, assume desktop Ollama instance
  return DEFAULT_OLLAMA_URL;
};

// Create Axios instance for Ollama API
const ollamaClient = axios.create({
  baseURL: getOllamaUrl(),
  timeout: 300000, // 5 minutes for long generations
  headers: {
    'Content-Type': 'application/json',
  },
});

// Health check
export const checkOllamaHealth = async (): Promise<boolean> => {
  try {
    const response = await ollamaClient.get('/api/tags');
    return response.status === 200;
  } catch (error) {
    console.error('Ollama health check failed:', error);
    return false;
  }
};

// Generate lesson
export const generateLesson = async (
  topic: string,
  difficulty: 'beginner' | 'intermediate' | 'expert' = 'intermediate',
  format: 'lesson' | 'podcast' = 'lesson'
): Promise<Lesson> => {
  const systemPrompt = `You are an expert educational content creator. Create comprehensive, accurate, and engaging learning materials.

Difficulty level: ${difficulty}
Format: ${format === 'podcast' ? 'Audio script format with host dialogue' : 'Structured lesson with sections and glossary'}`;

  const userPrompt = `Create a detailed lesson about: ${topic}

Include:
- Clear title
- Multiple sections with headings and content
- Glossary of key terms
- Learning objectives
${format === 'podcast' ? '- Conversational tone suitable for audio' : '- Technical accuracy with real-world examples'}`;

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  try {
    const response = await ollamaClient.post<OllamaChatResponse>('/api/chat', {
      model: DEFAULT_MODEL,
      messages,
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 4096
      }
    });

    const content = response.data.message.content;
    
    // Parse the generated content into structured lesson
    // In production, you'd use more sophisticated parsing
    const lesson: Lesson = {
      title: `${topic} - ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} Level`,
      sections: [
        {
          heading: 'Introduction',
          content: content.split('\n\n')[0] || content
        },
        {
          heading: 'Main Content',
          content: content
        }
      ],
      glossary: []
    };

    return LessonSchema.parse(lesson);
  } catch (error) {
    console.error('Lesson generation failed:', error);
    throw new Error('Failed to generate lesson. Ensure Ollama is running and the model is available.');
  }
};

// Get available models
export const getAvailableModels = async (): Promise<string[]> => {
  try {
    const response = await ollamaClient.get('/api/tags');
    const models = response.data.models || [];
    return models.map((m: any) => m.name || m.model);
  } catch (error) {
    console.error('Failed to fetch models:', error);
    return [DEFAULT_MODEL];
  }
};

export default {
  checkOllamaHealth,
  generateLesson,
  getAvailableModels
};
