import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { HomeScreen } from './src/screens/HomeScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LessonDetailScreen } from './src/screens/LessonDetailScreen';

export type RootStackParamList = {
  Home: undefined;
  Library: undefined;
  LessonDetail: { lesson: any };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#007AFF',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        <Stack.Screen 
          name="Home" 
          component={HomeScreen}
          options={{ title: 'Study Studio' }}
        />
        <Stack.Screen 
          name="Library" 
          component={LibraryScreen}
          options={{ title: 'My Library' }}
        />
        <Stack.Screen 
          name="LessonDetail" 
          component={LessonDetailScreen}
          options={{ title: 'Lesson Details' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
