// js/rajaongkir.js
// ============================================
// RAJAONGKIR SHIPPING SERVICE
// ============================================
// Menghubungkan toko ke RajaOngkir (versi API gratis dari Komerce:
// https://rajaongkir.komerce.id) untuk mengambil daftar kota/kabupaten
// dan menghitung ongkos kirim (ongkir) secara realtime.
//
// CATATAN PENTING:
// - Daftar akun gratis di https://rajaongkir.komerce.id untuk mendapatkan API Key,
//   lalu masukkan API Key tsb di Admin → Pengaturan → Pengiriman (RajaOngkir).
// - Paket gratis RajaOngkir hanya mendukung kurir tertentu (umumnya JNE, J&T, SiCepat).
// - Karena RajaOngkir tidak selalu mengizinkan pemanggilan langsung dari browser
//   (CORS), sebaiknya panggilan API ini diteruskan lewat proxy/serverless function
//   milik toko sendiri. Jika permintaan gagal (mis. karena CORS/API key belum
//   diisi), modul ini otomatis jatuh ke estimasi ongkir lokal (FALLBACK_RATES)
//   supaya proses checkout tetap berjalan.

const DEFAULT_BASE_URL = 'https://rajaongkir.komerce.id/api/v1';

// Estimasi ongkir cadangan (dipakai kalau API RajaOngkir tidak bisa diakses).
// Nilainya dalam Rupiah per pengiriman, dihitung dari berat (kg dibulatkan ke atas).
const FALLBACK_RATE_PER_KG = 9000;
const FALLBACK_BASE_COST = 9000;

export class RajaOngkirService {
  /**
   * @param {Object} settings - pengaturan toko (this.app.settings)
   *   settings.rajaOngkirApiKey  - API key dari rajaongkir.komerce.id
   *   settings.rajaOngkirBaseUrl - opsional, override base URL API
   *   settings.originCityId      - id kota/kabupaten asal (gudang/toko)
   *   settings.originCityName    - nama kota asal (untuk ditampilkan)
   */
  constructor(settings = {}) {
    this.apiKey = settings.rajaOngkirApiKey || '';
    this.baseUrl = settings.rajaOngkirBaseUrl || DEFAULT_BASE_URL;
    this.originCityId = settings.originCityId || '';
    this.originCityName = settings.originCityName || '';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.originCityId);
  }

  headers() {
    return {
      'Content-Type': 'application/json',
      key: this.apiKey
    };
  }

  /**
   * Cari kota/kabupaten tujuan berdasarkan nama (dipakai untuk autocomplete
   * di form checkout). Mengembalikan array [{id, label}].
   */
  async searchDestination(query) {
    if (!query || query.trim().length < 3) return [];
    if (!this.apiKey) return [];

    try {
      const url = `${this.baseUrl}/destination/domestic-destination?search=${encodeURIComponent(query.trim())}&limit=10`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) throw new Error(`RajaOngkir search gagal (${res.status})`);
      const json = await res.json();
      const list = json?.data || json?.rajaongkir?.results || [];

      return list.map(d => ({
        id: d.id ?? d.city_id ?? d.subdistrict_id,
        label: d.label ?? [d.subdistrict_name, d.city_name, d.province_name].filter(Boolean).join(', ')
      })).filter(d => d.id);
    } catch (err) {
      console.warn('⚠️ RajaOngkir searchDestination gagal, form tetap bisa diisi manual:', err.message);
      return [];
    }
  }

  /**
   * Hitung ongkos kirim.
   * @param {Object} params
   *   destinationId - id kota/kabupaten/kecamatan tujuan (dari searchDestination)
   *   weightGram    - total berat belanjaan dalam gram
   *   courier       - kode kurir rajaongkir, mis. "jne", "jnt", "sicepat"
   * @returns {Promise<{ok:boolean, cost:number, service:string, etd:string, source:'rajaongkir'|'fallback', error?:string}>}
   */
  async getCost({ destinationId, weightGram = 1000, courier = 'jne' }) {
    const weight = Math.max(1, Math.round(weightGram));

    if (!this.isConfigured() || !destinationId) {
      return this.fallbackCost(weight);
    }

    try {
      const body = new URLSearchParams({
        origin: String(this.originCityId),
        destination: String(destinationId),
        weight: String(weight),
        courier: String(courier || 'jne').toLowerCase()
      });

      const res = await fetch(`${this.baseUrl}/calculate/domestic-cost`, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!res.ok) throw new Error(`RajaOngkir cost gagal (${res.status})`);
      const json = await res.json();
      const results = json?.data || json?.rajaongkir?.results?.[0]?.costs || [];

      if (!Array.isArray(results) || results.length === 0) {
        throw new Error('Layanan kurir tidak ditemukan untuk rute ini');
      }

      // Ambil layanan termurah dari kurir yang dipilih (mis. REG/OKE/YES)
      const cheapest = results.reduce((min, cur) => {
        const curCost = cur.cost ?? cur.value ?? 0;
        const minCost = min.cost ?? min.value ?? Infinity;
        return curCost < minCost ? cur : min;
      }, results[0]);

      return {
        ok: true,
        cost: Math.round(cheapest.cost ?? cheapest.value ?? 0),
        service: cheapest.service || cheapest.description || courier.toUpperCase(),
        etd: cheapest.etd ? `${cheapest.etd} hari` : '-',
        source: 'rajaongkir'
      };
    } catch (err) {
      console.warn('⚠️ RajaOngkir getCost gagal, memakai estimasi ongkir lokal:', err.message);
      const fallback = this.fallbackCost(weight);
      fallback.error = err.message;
      return fallback;
    }
  }

  fallbackCost(weightGram) {
    const kg = Math.max(1, Math.ceil(weightGram / 1000));
    const cost = FALLBACK_BASE_COST + (kg - 1) * FALLBACK_RATE_PER_KG;
    return {
      ok: true,
      cost,
      service: 'Estimasi',
      etd: '2-4 hari (estimasi)',
      source: 'fallback'
    };
  }
}
