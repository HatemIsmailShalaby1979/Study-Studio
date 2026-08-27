import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { getLibrary, deleteLesson, LibraryLesson } from '../utils/storage';

interface LibraryScreenProps {
  navigation: any;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = ({ navigation }) => {
  const [lessons, setLessons] = useState<LibraryLesson[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadLibrary = async () => {
    const library = await getLibrary();
    setLessons(library);
  };

  useEffect(() => {
    loadLibrary();
    
    // Listen for focus to refresh when coming back from lesson view
    const unsubscribe = navigation.addListener('focus', () => {
      loadLibrary();
    });
    
    return unsubscribe;
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLibrary();
    setRefreshing(false);
  };

  const handleDelete = (lessonId: string) => {
    Alert.alert(
      'Delete Lesson',
      'Are you sure you want to delete this lesson?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteLesson(lessonId);
            await loadLibrary();
          }
        }
      ]
    );
  };

  const renderItem = ({ item }: { item: LibraryLesson }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('LessonDetail', { lesson: item })}
    >
      <View style={styles.cardHeader}>
        <View style={styles.badgeContainer}>
          <Text style={[
            styles.badge,
            styles[`badge_${item.difficulty}`]
          ]}>
            {item.difficulty.charAt(0).toUpperCase() + item.difficulty.slice(1)}
          </Text>
          <Text style={styles.badge}>
            {item.type === 'podcast' ? '🎙️' : '📖'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => handleDelete(item.id)}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonText}>🗑️</Text>
        </TouchableOpacity>
      </View>
      
      <Text style={styles.title}>{item.title}</Text>
      
      <Text style={styles.topic} numberOfLines={2}>
        Topic: {item.inputText}
      </Text>
      
      <Text style={styles.date}>
        {new Date(item.createdAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </Text>
    </TouchableOpacity>
  );

  if (lessons.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📚</Text>
        <Text style={styles.emptyTitle}>No lessons yet</Text>
        <Text style={styles.emptyText}>
          Generate your first lesson from the home screen!
        </Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.createButtonText}>Create Lesson</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      data={lessons}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    />
  );
};

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 12,
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
  deleteButton: {
    padding: 4,
  },
  deleteButtonText: {
    fontSize: 18,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  topic: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  date: {
    fontSize: 12,
    color: '#999',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
