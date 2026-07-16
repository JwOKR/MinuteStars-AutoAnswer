/**
 * 统一错误处理
 * 消除分散的 try-catch 和静默失败
 */

/**
 * 安全执行存储操作
 * @param {'get'|'set'|'remove'} action
 * @param {string} key
 * @param {*} [value]
 * @returns {*|boolean} get 返回值，set/remove 返回成功与否
 */
export function safeStorage(action, key, value) {
  try {
    switch (action) {
      case 'get':
        return GM_getValue(key);
      case 'set':
        GM_setValue(key, typeof value === 'string' ? value : JSON.stringify(value));
        return true;
      case 'remove':
        GM_deleteValue(key);
        return true;
      default:
        return false;
    }
  } catch (e) {
    console.error(`[Storage] ${action} "${key}" failed:`, e);
    return action === 'get' ? undefined : false;
  }
}

/**
 * 安全 JSON 解析
 * @param {string} text
 * @param {*} fallback - 解析失败时的默认值
 * @returns {*}
 */
export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * 包装异步操作，统一错误处理
 * @param {Function} fn - 异步函数
 * @param {string} context - 上下文描述
 * @param {Object} options
 * @param {number} [options.retries=0] - 重试次数
 * @param {number} [options.retryDelay=500] - 重试间隔
 * @param {boolean} [options.silent=false] - 是否静默失败
 * @returns {Promise<{ok: boolean, data?: *, error?: string}>}
 */
export async function safeAsync(fn, context, { retries = 0, retryDelay = 500, silent = false } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (e) {
      const isLastAttempt = attempt === retries;
      const errorMsg = `${context}: ${e.message}`;

      if (!silent) {
        console.error(`[Async] ${errorMsg}${!isLastAttempt ? ` (retry ${attempt + 1}/${retries})` : ''}`);
      }

      if (isLastAttempt) {
        return { ok: false, error: e.message };
      }

      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
}

// 使用示例：
// const { ok, data, error } = await safeAsync(
//   () => _readRepoFile(CFG.cloudFilePath),
//   '读取云端题库',
//   { retries: 2, retryDelay: 1000 }
// );
// if (!ok) {
//   uLog('❌ 读取失败: ' + error, 'err');
//   return;
// }
