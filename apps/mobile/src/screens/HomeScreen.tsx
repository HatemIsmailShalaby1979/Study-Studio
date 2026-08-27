import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { generateLesson, checkOllamaHealth } from '../services/ollama';
import { saveLesson } from '../utils/storage';
import { Lesson } from '../services/ollama';

interface HomeScreenProps {
  navigation: any;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<'beginner' | 'intermediate' | 'expert'>('intermediate');
  const [format, setFormat] = useState<'lesson' | 'podcast'>('lesson');
  const [loading, setLoading] = useState(false);
  const [ollamaAvailable, setOllamaAvailable] = useState(true);

  // Check Ollama health on mount
  React.useEffect(() => {
    const checkHealth = async () => {
      const healthy = await checkOllamaHealth();
      setOllamaAvailable(healthy);
      if (!healthy) {
        Alert.alert(
          'Ollama Not Available',
          'Please ensure Ollama is running on your desktop at http://localhost:11434.\n\nYour mobile device and desktop must be on the same WiFi network.',
          [{ text: 'OK' }]
        );
      }
    };
    checkHealth();
  }, []);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      Alert.alert('Error', 'Please enter a topic');
      return;
    }

    if (!ollamaAvailable) {
      Alert.alert(
        'Connection Error',
        'Ollama is not available. Please check that:\n1. Ollama is running on your desktop\n2. Both devices are on the same WiFi network\n3. Your desktop IP address is configured correctly'
      );
      return;
    }

    setLoading(true);
    try {
      const lesson = await generateLesson(topic, difficulty, format);
      
      // Save to library with metadata
      const lessonWithMeta = {
        ...lesson,
        id: Date.now().toString(),
        createdAt: Date.now(),
        inputText: topic,
        type: format,
        difficulty
      };

      await saveLesson(lessonWithMeta);
      
      Alert.alert(
        'Success!',
        'Lesson generated and saved to your library.',
        [
          { text: 'View Library', onPress: () => navigation.navigate('Library') },
          { text: 'Generate Another', style: 'cancel' }
        ]
      );
      
      setTopic('');
    } catch (error: any) {
      Alert.alert(
        'Generation Failed',
        error.message || 'Failed to generate lesson. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Study Studio Mobile</Text>
          <Text style={styles.subtitle}>Learn anything with AI</Text>
        </View>
        <TouchableOpacity
          style={styles.libraryButton}
          onPress={() => navigation.navigate('Library')}
        >
          <Text style={styles.libraryButtonText}>📚 Library</Text>
        </TouchableOpacity>
      </View>

      {!ollamaAvailable && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>⚠️ Ollama not connected</Text>
          <Text style={styles.warningSubtext}>Check desktop connection</Text>
        </View>
      )}

      <View style={styles.inputSection}>
        <Text style={styles.label}>What do you want to learn?</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Quantum Computing, Python Basics, Renaissance Art"
          value={topic}
          onChangeText={setTopic}
          editable={!loading}
          multiline
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Difficulty Level</Text>
        <View style={styles.buttonGroup}>
          {(['beginner', 'intermediate', 'expert'] as const).map((level) => (
            <TouchableOpacity
              key={level}
              style={[
                styles.difficultyButton,
                difficulty === level && styles.difficultyButtonActive
              ]}
              onPress={() => setDifficulty(level)}
              disabled={loading}
            >
              <Text
                style={[
                  styles.difficultyButtonText,
                  difficulty === level && styles.difficultyButtonTextActive
                ]}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Format</Text>
        <View style={styles.buttonGroup}>
          {(['lesson', 'podcast'] as const).map((fmt) => (
            <TouchableOpacity
              key={fmt}
              style={[styles.formatButton, format === fmt && styles.formatButtonActive]}
              onPress={() => setFormat(fmt)}
              disabled={loading}
            >
              <Text
                style={[styles.formatButtonText, format === fmt && styles.formatButtonTextActive]}
              >
                {fmt === 'lesson' ? '📖 Lesson' : '🎙️ Podcast'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.generateButton, loading && styles.generateButtonDisabled]}
        onPress={handleGenerate}
        disabled={loading || !ollamaAvailable}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.generateButtonText}>Generate Lesson</Text>
        )}
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Powered by Ollama • Runs on your desktop
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  warningBanner: {
    backgroundColor: '#fff3cd',
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
    padding: 12,
    marginBottom: 20,
    borderRadius: 4,
  },
  warningText: {
    color: '#856404',
    fontWeight: '600',
    fontSize: 14,
  },
  warningSubtext: {
    color: '#856404',
    fontSize: 12,
    marginTop: 4,
  },
  inputSection: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  section: {
    marginBottom: 24,
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  difficultyButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  difficultyButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  difficultyButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  difficultyButtonTextActive: {
    color: '#fff',
  },
  formatButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  formatButtonActive: {
    backgroundColor: '#34C759',
    borderColor: '#34C759',
  },
  formatButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  formatButtonTextActive: {
    color: '#fff',
  },
  generateButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  generateButtonDisabled: {
    backgroundColor: '#ccc',
  },
  generateButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  footerText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
  },
  header: {
    marginBottom: 30,
  },
  libraryButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  libraryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
});
