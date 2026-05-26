import type { IncomingMessage, ServerResponse } from 'http';
import { handleProfileLandmarks } from '../server/profile-landmarks-handler.mjs';

export const maxDuration = 20;

export default async function profileLandmarksHandler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  await handleProfileLandmarks(req, res);
}
