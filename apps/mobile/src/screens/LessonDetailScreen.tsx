import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Lesson } from '../services/ollama';
import { shareLessonFile } from '../utils/audioExport';

interface LessonDetailScreenProps {
  route: any;
  navigation: any;
}

interface LessonItem extends Lesson {
  id: string;
  createdAt: number;
  inputText: string;
  type: 'lesson' | 'podcast';
  difficulty: 'beginner' | 'intermediate' | 'expert';
}

export const LessonDetailScreen: React.FC<LessonDetailScreenProps> = ({ route, navigation }) => {
  const lesson: LessonItem = route.params?.lesson;
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    if (!lesson) return;
    setSharing(true);
    try {
      const uri = await shareLessonFile(lesson);
      Alert.alert('Exported', `Saved to app documents:\n${uri}`);
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setSharing(false);
    }
  };

  if (!lesson) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Lesson not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.badgeContainer}>
          <Text style={[
            styles.badge,
            styles[`badge_${lesson.difficulty}`]
          ]}>
            {lesson.difficulty.charAt(0).toUpperCase() + lesson.difficulty.slice(1)}
          </Text>
          <Text style={styles.badge}>
            {lesson.type === 'podcast' ? '🎙️ Podcast' : '📖 Lesson'}
          </Text>
        </View>
        
        <Text style={styles.title}>{lesson.title}</Text>
        
        <Text style={styles.topic}>
          Topic: {lesson.inputText}
        </Text>
        
        <Text style={styles.date}>
          Created: {new Date(lesson.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </Text>

        <TouchableOpacity
          style={[styles.shareButton, sharing && styles.shareButtonDisabled]}
          onPress={handleShare}
          disabled={sharing}
        >
          {sharing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.shareButtonText}>📤 Share / Export</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {lesson.sections.map((section, index) => (
          <View key={index} style={styles.section}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
            <Text style={styles.sectionContent}>{section.content}</Text>
          </View>
        ))}

        {lesson.glossary && lesson.glossary.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Glossary</Text>
            {lesson.glossary.map((term, index) => (
              <View key={index} style={styles.glossaryItem}>
                <Text style={styles.glossaryTerm}>{term.term}</Text>
                <Text style={styles.glossaryDefinition}>{term.definition}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.backButtonWide}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Back to Library</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: '#f0f0f0',
  },
  badge_beginner: {
    backgroundColor: '#d4edda',
    color: '#155724',
  },
  badge_intermediate: {
    backgroundColor: '#fff3cd',
    color: '#856404',
  },
  badge_expert: {
    backgroundColor: '#f8d7da',
    color: '#721c24',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  topic: {
    fontSize: 16,
    color: '#666',
    marginBottom: 4,
  },
  date: {
    fontSize: 14,
    color: '#999',
  },
  shareButton: {
    marginTop: 14,
    backgroundColor: '#34C759',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButtonDisabled: {
    opacity: 0.6,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeading: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  sectionContent: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
  },
  glossaryItem: {
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  glossaryTerm: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  glossaryDefinition: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  footer: {
    padding: 20,
    paddingBottom: 40,
  },
  backButtonWide: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
});
