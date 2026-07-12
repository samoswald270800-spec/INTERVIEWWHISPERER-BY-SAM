/**
 * Shared WebRTC ICE configuration for authenticated and guest media sessions.
 */
export function buildIceServers() {
  if (process.env.WEBRTC_ICE_SERVERS) {
    try {
      const custom = JSON.parse(process.env.WEBRTC_ICE_SERVERS);
      if (Array.isArray(custom) && custom.length) return custom;
    } catch (error) {
      console.warn('Invalid WEBRTC_ICE_SERVERS JSON, falling back to defaults:', error.message);
    }
  }

  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }

  return servers;
}

export default buildIceServers;
