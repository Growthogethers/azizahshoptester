// js/storage.js
export class Storage {
    static async uploadImage(file, path = 'products') {
        return Storage.uploadFile(file, path);
    }

    /**
     * Upload video produk ke Firebase Storage. Dipakai untuk fitur etalase
     * (produk bisa punya 1 video), karena video terlalu besar untuk disimpan
     * sebagai base64 di dalam dokumen Firestore.
     */
    static async uploadVideo(file, path = 'products/videos', onProgress = null) {
        return Storage.uploadFile(file, path, onProgress);
    }

    static async uploadFile(file, path = 'products', onProgress = null) {
        try {
            if (typeof firebase === 'undefined' || !firebase.storage) {
                console.warn('⚠️ Firebase Storage not available');
                return null;
            }
            
            const storageRef = firebase.storage().ref();
            const fileName = `${Date.now()}_${file.name}`;
            const fileRef = storageRef.child(`${path}/${fileName}`);
            
            const uploadTask = fileRef.put(file);
            
            return new Promise((resolve, reject) => {
                uploadTask.on('state_changed',
                    (snapshot) => {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        console.log(`📤 Upload progress: ${progress.toFixed(1)}%`);
                        if (typeof onProgress === 'function') onProgress(progress);
                    },
                    (error) => {
                        reject(error);
                    },
                    async () => {
                        const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
                        resolve(downloadURL);
                    }
                );
            });
        } catch (error) {
            console.error('Upload error:', error);
            throw error;
        }
    }
    
    static async deleteImage(url) {
        return Storage.deleteFile(url);
    }

    static async deleteFile(url) {
        try {
            if (!url || typeof firebase === 'undefined' || !firebase.storage) {
                return;
            }
            // File berupa base64 data URL (foto lama) tidak ada di Storage, jadi skip.
            if (!url.startsWith('http')) return;
            const ref = firebase.storage().refFromURL(url);
            await ref.delete();
        } catch (error) {
            console.warn('Delete error:', error);
        }
    }
}