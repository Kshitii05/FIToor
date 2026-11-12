import { PrismaClient } from '@prisma/client';
// Importing env first guarantees DATABASE_URL is loaded and validated.
import '../config/env.js';

export const db = new PrismaClient();
