import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  FlatList,
  Linking,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'checkin_history';

export default function App() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');

  // ─── Load persisted data on startup (Level 2: Persistensi) ───
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch (e) {
      console.log('Load error:', e);
    }
  };

  const saveHistory = async (newHistory) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.log('Save error:', e);
    }
  };

  // ─── Permission helpers ───
  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        '📷 Izin Kamera Diperlukan',
        'Aplikasi membutuhkan akses kamera untuk selfie check-in. Aktifkan di Pengaturan.',
        [
          { text: 'Batal', style: 'cancel' },
          { text: '⚙️ Buka Pengaturan', onPress: () => Linking.openSettings() }, // Level 2: Tombol Settings
        ]
      );
      return false;
    }
    return true;
  };

  const requestGalleryPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        '🖼️ Izin Galeri Diperlukan',
        'Aplikasi membutuhkan akses galeri untuk memilih foto.',
        [
          { text: 'Batal', style: 'cancel' },
          { text: '⚙️ Buka Pengaturan', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }
    return true;
  };

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        '📍 Izin Lokasi Diperlukan',
        'Aplikasi membutuhkan akses lokasi untuk mencatat posisi check-in.',
        [
          { text: 'Batal', style: 'cancel' },
          { text: '⚙️ Buka Pengaturan', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }
    return true;
  };

  // ─── Pick photo: Camera or Gallery (Level 2: Kamera + Galeri) ───
  const pickPhoto = () => {
    Alert.alert(
      '📸 Pilih Sumber Foto',
      'Ambil foto dari mana?',
      [
        { text: 'Kamera', onPress: () => openCamera() },
        { text: 'Galeri', onPress: () => openGallery() },
        { text: 'Batal', style: 'cancel' },
      ]
    );
  };

  const openCamera = async () => {
    const granted = await requestCameraPermission();
    if (!granted) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled) {                // ← cek canceled dulu
      const uri = result.assets[0].uri;
      await doCheckIn(uri);
    }
  };

  const openGallery = async () => {
    const granted = await requestGalleryPermission();
    if (!granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled) {                // ← cek canceled dulu
      const uri = result.assets[0].uri;
      await doCheckIn(uri);
    }
  };

  // ─── Main check-in flow: foto + GPS + cuaca (Level 2: Kamera+Lokasi, Level 3: cuaca) ───
  const doCheckIn = async (photoUri) => {
    setLoading(true);

    try {
      // 1. Minta izin lokasi
      setLoadingMsg('📍 Mengambil lokasi...');
      const locGranted = await requestLocationPermission();
      if (!locGranted) { setLoading(false); return; }

      const locResult = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = locResult.coords;

      // 2. Reverse geocoding (Level 3 Bonus)
      setLoadingMsg('🗺️ Mengidentifikasi tempat...');
      let placeName = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (geo.length > 0) {
          const g = geo[0];
          const parts = [g.name, g.street, g.district, g.city].filter(Boolean);
          placeName = parts.join(', ') || placeName;
        }
      } catch (_) {}

      // 3. Fetch cuaca dari Open-Meteo (Level 3 Bonus)
      setLoadingMsg('🌤️ Mengambil data cuaca...');
      let weather = null;
      try {
        const weatherUrl =
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&current_weather=true&hourly=relative_humidity_2m&forecast_days=1`;
        const resp = await fetch(weatherUrl);
        const data = await resp.json();
        if (data.current_weather) {
          weather = {
            temp: data.current_weather.temperature,
            windspeed: data.current_weather.windspeed,
            code: data.current_weather.weathercode,
          };
        }
      } catch (_) {}

      // 4. Simpan check-in baru
      const newEntry = {
        id: Date.now().toString(),
        photoUri,
        latitude,
        longitude,
        placeName,
        weather,
        timestamp: new Date().toLocaleString('id-ID'),
      };

      const newHistory = [newEntry, ...history];
      setHistory(newHistory);
      await saveHistory(newHistory);       // Level 2: Persistensi

      Alert.alert('✅ Check-in Berhasil!', `Lokasi: ${placeName}`);
    } catch (err) {
      Alert.alert('❌ Gagal', 'Terjadi kesalahan saat check-in. Pastikan GPS aktif.');
      console.log(err);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // ─── Buka di Google Maps (Level 2: Buka di Maps) ───
  const openInMaps = (lat, lng) => {
    const url = `https://maps.google.com/?q=${lat},${lng}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Alert.alert('Gagal', 'Tidak bisa membuka Google Maps.');
      }
    });
  };

  // ─── Hapus entry (Level 3 Bonus) ───
  const deleteEntry = async (id) => {
    Alert.alert('Hapus Check-in', 'Yakin ingin menghapus entri ini?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          const updated = history.filter((e) => e.id !== id);
          setHistory(updated);
          await saveHistory(updated);
        },
      },
    ]);
  };

  const getWeatherEmoji = (code) => {
    if (code === 0) return '☀️';
    if (code <= 3) return '⛅';
    if (code <= 67) return '🌧️';
    if (code <= 77) return '❄️';
    if (code <= 99) return '⛈️';
    return '🌡️';
  };

  // ─── Render tiap entri check-in ───
  const renderItem = ({ item }) => (
    <View style={styles.card}>
      {/* Foto */}
      <Image source={{ uri: item.photoUri }} style={styles.cardPhoto} />

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTime}>🕐 {item.timestamp}</Text>
        <Text style={styles.cardPlace} numberOfLines={2}>📍 {item.placeName}</Text>
        <Text style={styles.cardCoords}>
          {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
        </Text>

        {/* Cuaca */}
        {item.weather && (
          <View style={styles.weatherBadge}>
            <Text style={styles.weatherText}>
              {getWeatherEmoji(item.weather.code)}{' '}
              {item.weather.temp}°C · 💨 {item.weather.windspeed} km/h
            </Text>
          </View>
        )}

        {/* Tombol aksi */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.btnMaps}
            onPress={() => openInMaps(item.latitude, item.longitude)}
          >
            <Text style={styles.btnMapsText}>🗺️ Buka Maps</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnDelete}
            onPress={() => deleteEntry(item.id)}
          >
            <Text style={styles.btnDeleteText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // ─── UI ───
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📍 CheckIn App</Text>
        <Text style={styles.headerSub}>Absensi Selfie + Lokasi + Cuaca</Text>
      </View>

      {/* Tombol Check-in */}
      <TouchableOpacity
        style={[styles.checkInBtn, loading && styles.checkInBtnDisabled]}
        onPress={pickPhoto}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.checkInBtnText}> {loadingMsg}</Text>
          </View>
        ) : (
          <Text style={styles.checkInBtnText}>📸 CHECK IN SEKARANG</Text>
        )}
      </TouchableOpacity>

      {/* Riwayat */}
      <Text style={styles.sectionTitle}>
        📋 Riwayat Check-in ({history.length})
      </Text>

      {history.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>Belum ada check-in.</Text>
          <Text style={styles.emptyHint}>Tekan tombol di atas untuk mulai!</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
  },
  header: {
    backgroundColor: '#1a1a2e',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 16 : 56,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  headerSub: {
    fontSize: 13,
    color: '#a0aec0',
    marginTop: 4,
  },
  checkInBtn: {
    backgroundColor: '#6c63ff',
    marginHorizontal: 20,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#6c63ff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  checkInBtnDisabled: {
    backgroundColor: '#9b95d8',
  },
  checkInBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2d3748',
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardPhoto: {
    width: '100%',
    height: 200,            // ← WAJIB punya height
    resizeMode: 'cover',
  },
  cardInfo: {
    padding: 14,
  },
  cardTime: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 4,
  },
  cardPlace: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: 2,
  },
  cardCoords: {
    fontSize: 11,
    color: '#a0aec0',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 8,
  },
  weatherBadge: {
    backgroundColor: '#ebf8ff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  weatherText: {
    fontSize: 13,
    color: '#2b6cb0',
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  btnMaps: {
    backgroundColor: '#e6f0ff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  btnMapsText: {
    color: '#3b82f6',
    fontWeight: '600',
    fontSize: 13,
  },
  btnDelete: {
    backgroundColor: '#fff5f5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDeleteText: {
    fontSize: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4a5568',
  },
  emptyHint: {
    fontSize: 13,
    color: '#a0aec0',
    marginTop: 4,
  },
});