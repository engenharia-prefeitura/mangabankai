const { ensureConnection } = require('./db');

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
}

async function checkRateLimit(key, maxPoints, durationSeconds) {
  const sql = await ensureConnection();
  const now = new Date();
  
  // Clean up expired entries first
  try {
    await sql`DELETE FROM rate_limits WHERE expire_at < ${now}`;
  } catch (e) {
    console.error('Erro ao limpar rate limits expirados:', e);
  }
  
  const expireAt = new Date(now.getTime() + durationSeconds * 1000);
  
  try {
    // Try to insert or update points
    const r = await sql`
      INSERT INTO rate_limits (key, points, expire_at)
      VALUES (${key}, 1, ${expireAt})
      ON CONFLICT (key) DO UPDATE SET
        points = rate_limits.points + 1
      RETURNING points, expire_at
    `;
    
    const record = r.rows[0];
    if (record.points > maxPoints) {
      const retryAfter = Math.ceil((new Date(record.expire_at).getTime() - now.getTime()) / 1000);
      return { limited: true, retryAfter };
    }
    return { limited: false };
  } catch (e) {
    console.error('Erro na verificação do rate limit:', e);
    // Em caso de falha no banco de rate limit, falha aberto para não bloquear usuários legítimos
    return { limited: false };
  }
}

module.exports = { checkRateLimit, getClientIp };
