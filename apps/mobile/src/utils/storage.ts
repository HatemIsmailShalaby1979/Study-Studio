import AsyncStorage from '@react-native-async-storage/async-storage';
import { Lesson } from '../services/ollama';

const LIBRARY_KEY = '@StudyStudio:library';

export type LibraryLesson = Lesson & {
  id: string;
  createdAt: number;
  inputText: string;
  type: 'lesson' | 'podcast';
  difficulty: 'beginner' | 'intermediate' | 'expert';
};

export const saveLesson = async (lesson: LibraryLesson): Promise<void> => {
  try {
    const existingLessons = await getLibrary();
    const updatedLibrary = [lesson, ...existingLessons];
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(updatedLibrary));
  } catch (error) {
    console.error('Failed to save lesson:', error);
    throw error;
  }
};

export const getLibrary = async (): Promise<LibraryLesson[]> => {
  try {
    const data = await AsyncStorage.getItem(LIBRARY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to load library:', error);
    return [];
  }
};

export const deleteLesson = async (lessonId: string): Promise<void> => {
  try {
    const existingLessons = await getLibrary();
    const updatedLibrary = existingLessons.filter(l => l.id !== lessonId);
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(updatedLibrary));
  } catch (error) {
    console.error('Failed to delete lesson:', error);
    throw error;
  }
};

export const exportLibrary = async (): Promise<string> => {
  try {
    const library = await getLibrary();
    return JSON.stringify(library, null, 2);
  } catch (error) {
    console.error('Failed to export library:', error);
    throw error;
  }
};

export const importLibrary = async (jsonString: string): Promise<void> => {
  try {
    const library = JSON.parse(jsonString);
    if (!Array.isArray(library)) {
      throw new Error('Invalid library format');
    }
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch (error) {
    console.error('Failed to import library:', error);
    throw error;
  }
};

export const clearLibrary = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(LIBRARY_KEY);
  } catch (error) {
    console.error('Failed to clear library:', error);
    throw error;
  }
};
