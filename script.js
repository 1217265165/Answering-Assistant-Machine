// ==UserScript==
// @name         跨页多模态极速答题辅助机—支持DeepSeek/豆包/Gemini/GPT(v1.0)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  修复UI遮挡问题，完美兼容自定义提示词 + 视觉选框绑定 + 方式1手动选取。
// @author       https://github.com/1217265165
// @match        https://chat.deepseek.com/*
// @match        https://www.doubao.com/*
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @match        *://*/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      uapis.cn
// ==/UserScript==

(function() {
    'use strict';

    const currentHost = location.hostname;
    const isAIPage = currentHost.includes('deepseek.com') ||
                     currentHost.includes('doubao.com') ||
                     currentHost.includes('gemini.google.com') ||
                     currentHost.includes('chatgpt.com');

    // 默认的初始系统提示词
    const DEFAULT_PROMPT = `你现在是一个极其严格且专业的考试答题系统。请仔细核查我发送给你的每一道题目，在内部进行严密的逻辑推导和事实核对，确保答案 100% 准确。绝不可胡乱猜测。

你的输出将被对接至自动化批改程序，因此**必须严格遵守以下输出格式，绝对禁止输出任何问候语、题目解析、思考过程或多余的标点符号**：

1. **单选题和多选题**：按题目顺序，**仅**输出大写字母组合（如：A、BCD、AD）。
2. **判断题**：按题目顺序，**仅**输出“对”或“错”。

以下是题目：\n\n`;

    // ==========================================
    // 模块 1：AI 页面接收端逻辑
    // ==========================================
    if (isAIPage) {
        console.log(`✅ 通用 AI 文本接收器已在 [${currentHost}] 启动，侦听中...`);

        GM_addValueChangeListener('ds_trigger_time', function(key, oldValue, newValue, remote) {
            if (!remote) return;

            const targetAI = GM_getValue('selected_target_ai', 'deepseek');

            if (currentHost.includes('deepseek.com') && targetAI !== 'deepseek') return;
            if (currentHost.includes('doubao.com') && targetAI !== 'doubao') return;
            if (currentHost.includes('gemini.google.com') && targetAI !== 'gemini') return;
            if (currentHost.includes('chatgpt.com') && targetAI !== 'gpt') return;

            const extractedText = GM_getValue('ds_target_text');
            if (!extractedText) return;

            let inputSelector = 'textarea';
            if (currentHost.includes('chatgpt.com')) inputSelector = '#prompt-textarea';
            if (currentHost.includes('gemini.google.com')) inputSelector = 'div[aria-label="输入提示词"]';
            if (currentHost.includes('doubao.com')) inputSelector = 'div[contenteditable="true"]';

            const aiInput = document.querySelector(inputSelector) || document.querySelector('textarea') || document.querySelector('div[contenteditable="true"]');
            if (!aiInput) return;

            // 读取最新的自定义提示词
            const customPrompt = GM_getValue('ds_custom_prompt', DEFAULT_PROMPT);

            let finalMessage = "";
            const sessionKey = `prompt_sent_${targetAI}`;
            if (!sessionStorage.getItem(sessionKey)) {
                // 首次发送拼接提示词
                finalMessage = customPrompt + extractedText;
                sessionStorage.setItem(sessionKey, 'true');
            } else {
                // 后续只发送题目
                finalMessage = extractedText;
            }

            if (aiInput.tagName === 'TEXTAREA' || aiInput.tagName === 'INPUT') {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set ||
                                               Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(aiInput, finalMessage);
                } else {
                    aiInput.value = finalMessage;
                }
            } else {
                aiInput.innerText = finalMessage;
                if(aiInput.innerHTML === '') aiInput.innerHTML = `<p>${finalMessage}</p>`;
            }

            aiInput.dispatchEvent(new Event('input', { bubbles: true }));
            aiInput.dispatchEvent(new Event('change', { bubbles: true }));
            aiInput.dispatchEvent(new Event('blur', { bubbles: true }));
            aiInput.focus();

            setTimeout(() => {
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                });
                aiInput.dispatchEvent(enterEvent);

                if (currentHost.includes('doubao.com')) {
                    const sendBtn = document.querySelector('button[data-testid="chat_input_send_button"]') || document.querySelector('.send-button');
                    if (sendBtn) sendBtn.click();
                }
            }, 400);
        });

        return;
    }

    // ==========================================
    // 模块 2：考试网页端逻辑
    // ==========================================
    let isPickingForBind = false;
    let isPickingManual = false;
    let lastHoveredElement = null;

    function generateUniqueSelector(el) {
        if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') return null;
        if (el.id) return `#${el.id}`;

        let selector = el.tagName.toLowerCase();
        if (el.classList.length > 0) {
            const classes = Array.from(el.classList).filter(c => !c.includes('ds-highlight'));
            if (classes.length > 0) {
                selector += '.' + classes.join('.');
            }
        }

        try {
            if (document.querySelectorAll(selector).length === 1) return selector;
        } catch (e) { }

        let parentSelector = generateUniqueSelector(el.parentElement);
        if (parentSelector) {
            return `${parentSelector} > ${el.tagName.toLowerCase()}:nth-of-type(${getNthOfType(el)})`;
        }
        return null;
    }

    function getNthOfType(el) {
        let count = 1;
        let p = el.previousElementSibling;
        while (p) {
            if (p.tagName === el.tagName) count++;
            p = p.previousElementSibling;
        }
        return count;
    }

    function processTargetElement(targetEl, buttonToUpdate) {
        if (!targetEl) return;
        const targetAI = GM_getValue('selected_target_ai', 'deepseek');

        if (buttonToUpdate) {
            buttonToUpdate.innerText = `⚡ 正在传送至 [${targetAI.toUpperCase()}]...`;
            buttonToUpdate.style.background = '#2196f3';
        }

        html2canvas(targetEl, { backgroundColor: '#ffffff', useCORS: true, logging: false }).then(canvas => {
            canvas.toBlob(blob => {
                if (!blob) {
                    if (buttonToUpdate) buttonToUpdate.innerText = '❌ 截图失败';
                    return;
                }
                const formData = new FormData();
                formData.append('file', blob, 'screenshot.png');
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://uapis.cn/api/v1/image/ocr',
                    data: formData,
                    onload: function(response) {
                        const previewBox = document.getElementById('ds-preview-box');
                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText);
                                const extractedText = data?.plain_text || data?.text || data?.data;
                                if (extractedText) {
                                    GM_setValue('ds_target_text', extractedText);
                                    GM_setValue('ds_trigger_time', Date.now());
                                    if (buttonToUpdate) {
                                        buttonToUpdate.innerText = '✅ 发送成功！';
                                        buttonToUpdate.style.background = '#27ae60';
                                    }
                                    if (previewBox) {
                                        previewBox.innerText = `🎯 [目标:${targetAI.toUpperCase()}] 已发内容：\n${extractedText.trim()}`;
                                        previewBox.style.display = 'block';
                                    }
                                }
                            } catch(err) { if (buttonToUpdate) buttonToUpdate.innerText = '❌ 解析错误'; }
                        } else { if (buttonToUpdate) buttonToUpdate.innerText = '❌ 线路繁忙'; }
                        setTimeout(() => resetUiState(), 1500);
                    },
                    onerror: function() {
                        if (buttonToUpdate) buttonToUpdate.innerText = '❌ 网络错误';
                        setTimeout(() => resetUiState(), 1500);
                    }
                });
            }, 'image/png');
        }).catch(() => {
            if (buttonToUpdate) buttonToUpdate.innerText = '❌ 渲染错误';
            setTimeout(() => resetUiState(), 1500);
        });
    }

    function resetUiState() {
        isPickingForBind = false;
        isPickingManual = false;
        document.body.style.cursor = 'default';

        const statusLabel = document.getElementById('ds-bind-status');
        const btn0 = document.getElementById('ds-btn-mode0');
        const btn1 = document.getElementById('ds-btn-mode1');

        const savedSelector = GM_getValue('ds_dynamic_selector', null);
        if (savedSelector) {
            if(statusLabel) {
                statusLabel.innerText = '🔴 自动抓取：已绑定';
                statusLabel.style.color = '#27ae60';
            }
            if(btn0) {
                btn0.innerText = '🚀 方式0：执行自动抓取';
                btn0.style.background = '#e74c3c';
            }
        } else {
             if(statusLabel) {
                statusLabel.innerText = '⚪ 自动抓取：尚未绑定';
                statusLabel.style.color = '#666';
            }
            if(btn0) {
                btn0.innerText = '⚠️ 请先点击上方[选框绑定]';
                btn0.style.background = '#95a5a6';
            }
        }

        // 确保方式1按钮每次都会正确恢复
        if (btn1) {
            btn1.innerText = '🟡 方式1：单次鼠标选取';
            btn1.style.background = '#34495e';
        }
        if (lastHoveredElement) { lastHoveredElement.style.outline = ''; lastHoveredElement = null; }
    }

    function createControlPanel() {
        if (document.getElementById('ds-control-group')) return;

        const container = document.createElement('div');
        container.id = 'ds-control-group';
        // 增加了 max-height 和 overflow-y 保证面板在小屏幕不会超出边界被隐藏
        container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:2147483647; display:flex; flex-direction:column; gap:6px; font-family:sans-serif; background:#ffffff; padding:12px; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.3); border:1px solid #ddd; width:280px; max-height:85vh; overflow-y:auto; box-sizing:border-box;';

        // 状态行
        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;';

        const statusLabel = document.createElement('div');
        statusLabel.id = 'ds-bind-status';
        statusLabel.style.cssText = 'font-size:12px; font-weight:bold;';
        statusRow.appendChild(statusLabel);

        const rebindBtn = document.createElement('button');
        rebindBtn.innerText = '🎯 选框绑定';
        rebindBtn.style.cssText = 'padding:4px 8px; font-size:11px; background:#f39c12; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;';
        rebindBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetUiState();
            isPickingForBind = true;
            rebindBtn.innerText = '🖱️ 请点题目框...';
            rebindBtn.style.background = '#d35400';
            document.body.style.cursor = 'crosshair';
            const btn0 = document.getElementById('ds-btn-mode0');
            if(btn0) {
                btn0.innerText = '⚠️ 正在绑定，请勿点击';
                btn0.style.background = '#95a5a6';
            }
        });
        statusRow.appendChild(rebindBtn);

        // AI 切换
        const aiSelector = document.createElement('select');
        aiSelector.id = 'ds-ai-selector';
        aiSelector.style.cssText = 'width:100%; padding:6px; border-radius:5px; border:1px solid #bbb; font-size:13px; font-weight:bold; background:#fff; outline:none; cursor:pointer; color:#333; box-sizing:border-box; margin-bottom:2px;';
        aiSelector.innerHTML = `
            <option value="deepseek">目标 AI: DeepSeek</option>
            <option value="doubao">目标 AI: 字节豆包</option>
            <option value="gemini">目标 AI: Google Gemini</option>
            <option value="gpt">目标 AI: ChatGPT</option>
        `;
        aiSelector.value = GM_getValue('selected_target_ai', 'deepseek');
        aiSelector.addEventListener('change', () => GM_setValue('selected_target_ai', aiSelector.value));

        // 自定义前置提示词
        const promptLabel = document.createElement('div');
        promptLabel.style.cssText = 'font-size:12px; color:#666; font-weight:bold; margin-top:2px; margin-bottom:-2px;';
        promptLabel.innerText = '📝 前置提示词 (仅每轮首题发):';

        const promptInput = document.createElement('textarea');
        promptInput.id = 'ds-custom-prompt';
        promptInput.style.cssText = 'width:100%; height:60px; padding:6px; border-radius:5px; border:1px solid #bbb; font-size:11px; font-family:sans-serif; background:#f9f9f9; outline:none; color:#333; box-sizing:border-box; resize:vertical; line-height:1.3;';
        promptInput.value = GM_getValue('ds_custom_prompt', DEFAULT_PROMPT);

        promptInput.addEventListener('input', (e) => {
            GM_setValue('ds_custom_prompt', e.target.value);
        });

        // 预览框
        const previewBox = document.createElement('div');
        previewBox.id = 'ds-preview-box';
        previewBox.style.cssText = 'max-height:80px; overflow-y:auto; background:#1e1e1e; color:#ffffff; padding:8px; border-radius:6px; font-size:12px; display:none; white-space:pre-wrap; word-break:break-all; border:1px solid #4caf50; box-sizing:border-box; margin-bottom:2px;';

        // 方式 0 按钮
        const btn0 = document.createElement('button');
        btn0.id = 'ds-btn-mode0';
        btn0.style.cssText = 'padding:10px; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:13px; width:100%; box-sizing:border-box;';

        btn0.addEventListener('click', (e) => {
            e.stopPropagation();
            if(isPickingForBind) return;

            const currentSelector = GM_getValue('ds_dynamic_selector', null);
            if (!currentSelector) {
                alert('⚠️ 尚未绑定区域！\n请先点击右上角的“🎯 选框绑定”按钮，在页面中框选出你要自动答题的区域。');
                return;
            }

            const targetEl = document.querySelector(currentSelector);
            if (targetEl) {
                processTargetElement(targetEl, btn0);
            } else {
                alert(`⚠️ 找不到绑定的区域，请点击“🎯 选框绑定”重新选取。`);
            }
        });

        // 方式 1 按钮（绝不丢失）
        const btn1 = document.createElement('button');
        btn1.id = 'ds-btn-mode1';
        btn1.style.cssText = 'padding:10px; background:#34495e; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:13px; width:100%; box-sizing:border-box; margin-top:2px;';
        btn1.innerText = '🟡 方式1：单次鼠标选取';

        btn1.addEventListener('click', (e) => {
            e.stopPropagation();
            if(isPickingForBind) return;

            isPickingManual = !isPickingManual;
            if (isPickingManual) {
                btn1.innerText = '🖱️ 请在网页上点击抓取区域...';
                btn1.style.background = '#16a085';
                document.body.style.cursor = 'crosshair';
            } else {
                resetUiState();
            }
        });

        // 按顺序挂载
        container.appendChild(statusRow);
        container.appendChild(aiSelector);
        container.appendChild(promptLabel);
        container.appendChild(promptInput);
        container.appendChild(previewBox);
        container.appendChild(btn0);
        container.appendChild(btn1);  // <--- 方式1 紧跟其后
        document.body.appendChild(container);

        setTimeout(resetUiState, 100);
    }

    // 悬停红框
    document.addEventListener('mouseover', (e) => {
        if ((!isPickingForBind && !isPickingManual) || e.target.closest('#ds-control-group')) return;
        if (lastHoveredElement && lastHoveredElement !== e.target) lastHoveredElement.style.outline = '';
        e.target.style.outline = '3px solid red';
        lastHoveredElement = e.target;
    }, true);

    // 点击截取
    document.addEventListener('click', (e) => {
        if (e.target.closest('#ds-control-group')) return;

        // 场景1：正在绑定方式0
        if (isPickingForBind) {
            e.preventDefault(); e.stopPropagation();
            const targetEl = e.target;

            const uniqueSelector = generateUniqueSelector(targetEl);
            if(uniqueSelector) {
                GM_setValue('ds_dynamic_selector', uniqueSelector);
                resetUiState();
            } else {
                alert('❌ 无法生成唯一路径，请换一个更外层的红框点击。');
                isPickingForBind = true;
            }
            return;
        }

        // 场景2：正在进行方式1手动截图
        if (isPickingManual) {
            e.preventDefault(); e.stopPropagation();
            const targetEl = e.target;
            const btn1 = document.getElementById('ds-btn-mode1');
            resetUiState(); // 立刻释放鼠标
            processTargetElement(targetEl, btn1);
            return;
        }
    }, true);

    // 下一题流转监控
    document.addEventListener('click', (e) => {
        const isNextBtn = e.target.id === 'next_question' || e.target.closest('#next_question');
        if (isNextBtn || e.target.innerText.match(/^\d+$/)) {
            setTimeout(() => {
                const currentSelector = GM_getValue('ds_dynamic_selector', null);
                const targetEl = document.querySelector(currentSelector);
                const btn0 = document.getElementById('ds-btn-mode0');
                if (currentSelector && targetEl && btn0) processTargetElement(targetEl, btn0);
            }, 600);
        }
    }, false);

    // 守护线程
    setInterval(() => { if (document.body) createControlPanel(); }, 2000);

})();
