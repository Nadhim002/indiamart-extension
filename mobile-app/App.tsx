import React from 'react';
import { View, Text } from 'react-native';
import { useFirebaseAuth } from './hooks/useFirebaseAuth';

export default function App() {
  const { uid, loading } = useFirebaseAuth();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>{loading ? 'Signing in...' : `UID: ${uid}`}</Text>
    </View>
  );
}
