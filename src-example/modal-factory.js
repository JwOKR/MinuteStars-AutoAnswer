/**
 * 统一弹窗工厂
 * 消除重复的弹窗创建代码
 */

const MODAL_STYLES = `
  .ata-modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,.5); z-index: 2147483646;
    display: flex; align-items: center; justify-content: center;
  }
  .ata-modal-box {
    background: var(--nm-bg); border-radius: 12px; padding: 20px;
    width: 700px; max-width: 90vw; max-height: 80vh; overflow: auto;
    box-shadow: 12px 12px 24px var(--nm-shadow-dark),
                -12px -12px 24px var(--nm-shadow-light);
    position: relative;
  }
  .ata-modal-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 16px; font-weight: 600; font-size: 14px;
  }
  .ata-modal-close {
    background: var(--nm-bg); border: none; padding: 6px 12px;
    border-radius: 6px; cursor: pointer; font-size: 12px;
    box-shadow: 2px 2px 4px var(--nm-shadow-dark),
                -2px -2px 4px var(--nm-shadow-light);
  }
  .ata-modal-close:hover {
    box-shadow: inset 2px 2px 4px var(--nm-shadow-dark),
                inset -2px -2px 4px var(--nm-shadow-light);
  }
`;

let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.textContent = MODAL_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

/**
 * 创建弹窗
 * @param {Object} options
 * @param {string} options.title - 标题
 * @param {string} options.content - 内容 HTML
 * @param {number} [options.width=700] - 宽度
 * @param {Function} [options.onClose] - 关闭回调
 * @returns {HTMLElement} overlay 元素
 */
export function createModal({ title, content, width = 700, onClose }) {
  ensureStyles();

  const overlay = document.createElement('div');
  overlay.className = 'ata-modal-overlay';
  overlay.innerHTML = `
    <div class="ata-modal-box" style="width:${width}px">
      <div class="ata-modal-header">
        <span>${title}</span>
        <button class="ata-modal-close">✕ 关闭</button>
      </div>
      <div class="ata-modal-body">${content}</div>
    </div>
  `;

  const close = () => {
    overlay.remove();
    onClose?.();
  };

  overlay.querySelector('.ata-modal-close').onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };

  return overlay;
}

/**
 * 创建统计卡片网格
 * @param {Array<{value: string|number, label: string, color?: string}>} cards
 * @returns {string} HTML
 */
export function createStatGrid(cards) {
  return `
    <div style="display:grid;grid-template-columns:repeat(${Math.min(cards.length, 4)},1fr);gap:8px;margin-bottom:12px">
      ${cards.map(c => `
        <div style="background:var(--nm-bg);padding:8px;border-radius:8px;text-align:center;
                    box-shadow:2px 2px 4px var(--nm-shadow-dark),-2px -2px 4px var(--nm-shadow-light)">
          <div style="font-size:20px;font-weight:700;color:${c.color || 'var(--nm-accent)'}">${c.value}</div>
          <div style="font-size:10px;color:var(--nm-text-secondary)">${c.label}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// 使用示例：
// const modal = createModal({
//   title: '📊 扫描结果',
//   content: createStatGrid([
//     { value: 10, label: '题目数' },
//     { value: 6000, label: '题库总数', color: '#48bb78' },
//     { value: 8, label: '可匹配', color: '#f59e0b' },
//   ]),
// });
// document.body.appendChild(modal);
