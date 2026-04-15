import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import HomeScreen from '../screens/HomeScreen';
import CreateRoomScreen from '../screens/CreateRoomScreen';
import LobbyScreen from '../screens/LobbyScreen';
import GameTableScreen from '../screens/GameTableScreen';
import CardGalleryScreen from '../screens/CardGalleryScreen';
import WinScreen from '../screens/WinScreen';
import { COLORS } from '../constants/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.bg },
          headerTintColor: COLORS.text,
          headerTitleStyle: { fontWeight: '800', fontSize: 14 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: COLORS.bg },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="CreateRoom" component={CreateRoomScreen} options={{ title: 'NEW ROOM' }} />
        <Stack.Screen name="Lobby" component={LobbyScreen} options={{ title: 'LOBBY' }} />
        <Stack.Screen name="GameTable" component={GameTableScreen} options={{ headerShown: false }} />
        <Stack.Screen name="CardGallery" component={CardGalleryScreen} options={{ title: 'CARDS' }} />
        <Stack.Screen name="Tutorial" component={CardGalleryScreen} options={{ title: 'HOW TO PLAY' }} />
        <Stack.Screen name="Win" component={WinScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
