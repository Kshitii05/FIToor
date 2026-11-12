import multer from 'multer';
import { AppError } from './errors.js';

const megabytes = (bytes) => Math.round(bytes / (1024 * 1024));

/**
 * Middleware that reads up to `maxFiles` uploaded files from the multipart field
 * `fieldName` into memory (`req.files`), each at most `maxBytes`.
 * Limits are enforced while the request streams in, before anything is stored.
 */
export function uploadImages({ fieldName, maxFiles, maxBytes }) {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: { files: maxFiles, fileSize: maxBytes, fields: 20, fieldSize: 100 * 1024 },
  }).array(fieldName, maxFiles);

  return function upload(req, res, next) {
    parse(req, res, (error) => {
      if (!error) return next();
      if (!(error instanceof multer.MulterError)) return next(error);

      switch (error.code) {
        case 'LIMIT_FILE_SIZE':
          return next(
            new AppError(
              400,
              'IMAGE_TOO_LARGE',
              `Each photo must be ${megabytes(maxBytes)} MB or smaller`,
            ),
          );
        case 'LIMIT_FILE_COUNT':
        case 'LIMIT_UNEXPECTED_FILE':
          return next(
            new AppError(400, 'TOO_MANY_IMAGES', `You can upload at most ${maxFiles} photos`),
          );
        default:
          return next(AppError.badRequest('The upload could not be read'));
      }
    });
  };
}
