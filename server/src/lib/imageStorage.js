import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { API_PREFIX } from '../config/app.js';
import { env } from '../config/env.js';

/**
 * ImageStorage interface:
 *   upload({ buffer, extension, folder }) -> { url, storageId }
 *   remove(storageId)
 *
 * With CLOUDINARY_* set, images go to Cloudinary. Without it, development keeps
 * them in a local folder served by this API so the app works without an account;
 * production refuses to accept uploads.
 */
export function createImageStorage() {
  if (env.CLOUDINARY_CLOUD_NAME) return createCloudinaryStorage();
  if (env.NODE_ENV === 'production') return createUnavailableStorage();
  return createLocalStorage();
}

function createCloudinaryStorage() {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  return {
    upload({ buffer, folder }) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, resource_type: 'image' },
          (error, result) => {
            if (error) reject(error);
            else resolve({ url: result.secure_url, storageId: result.public_id });
          },
        );
        stream.end(buffer);
      });
    },
    async remove(storageId) {
      await cloudinary.uploader.destroy(storageId, { resource_type: 'image' });
    },
  };
}

function createUnavailableStorage() {
  const fail = async () => {
    throw new Error('Image storage is not configured: set CLOUDINARY_* values');
  };
  return { upload: fail, remove: fail };
}

export const LOCAL_UPLOADS_ROUTE = `${API_PREFIX}/uploads`;
const LOCAL_UPLOADS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../uploads',
);

function createLocalStorage() {
  return {
    /** Folder to serve at LOCAL_UPLOADS_ROUTE. Present only on local storage. */
    localDirectory: LOCAL_UPLOADS_DIR,

    async upload({ buffer, extension, folder }) {
      const storageId = `${folder}/${crypto.randomUUID()}.${extension}`;
      const filePath = path.join(LOCAL_UPLOADS_DIR, storageId);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer);
      return { url: `${LOCAL_UPLOADS_ROUTE}/${storageId}`, storageId };
    },

    async remove(storageId) {
      const filePath = path.resolve(LOCAL_UPLOADS_DIR, storageId);
      // Never follow an identifier outside the uploads folder.
      if (!filePath.startsWith(LOCAL_UPLOADS_DIR + path.sep)) return;
      await fs.rm(filePath, { force: true });
    },
  };
}
