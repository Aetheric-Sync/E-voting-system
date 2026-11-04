import { useState } from 'react';
import { Button, SafeAreaView, Text, TextInput, View } from 'react-native';

// Skeleton. Phase 4 adds: OTP login, ballot screens per type, receipt storage in the
// secure enclave, offline kiosk mode, push notifications, i18n.
const API = 'http://localhost:3000';

export default function App() {
  const [electionId, setElectionId] = useState('');
  const [status, setStatus] = useState('');

  async function check() {
    try {
      const r = await fetch(`${API}/health`);
      setStatus(r.ok ? 'API reachable' : `API error ${r.status}`);
    } catch {
      setStatus('API unreachable');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: '600' }}>E-Voting</Text>
      <View style={{ marginTop: 16 }}>
        <TextInput
          placeholder="Election ID"
          value={electionId}
          onChangeText={setElectionId}
          style={{ borderWidth: 1, padding: 12, borderRadius: 8 }}
        />
        <Button title="Check connection" onPress={check} />
        <Text>{status}</Text>
      </View>
    </SafeAreaView>
  );
}
