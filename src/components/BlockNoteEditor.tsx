import React, { useMemo, useState, useEffect, useRef } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';

interface BlockNoteEditorProps {
  initialContent?: string;
  onChange: (blocks: any[]) => void;
  repoOwner: string;
  repoName: string;
  onPaywallTrigger?: (message?: string) => void;
}

export default function BlockNoteEditor({ initialContent, onChange, repoOwner, repoName, onPaywallTrigger }: BlockNoteEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState('');
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<'main' | 'tone' | 'translate'>('main');
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState('');

  // Safe initial content parsing
  const initialBlocks = useMemo(() => {
    if (!initialContent) return undefined;
    try {
      const parsed = JSON.parse(initialContent);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
    } catch (e) {
      console.error('Failed to parse initialContent in BlockNoteEditor:', e);
      return undefined;
    }
  }, [initialContent]);

  // Initialize the BlockNote editor with a custom R2 uploader hook that returns a caption
  const editor = useCreateBlockNote({
    initialContent: initialBlocks,
    uploadFile: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('repo_owner', repoOwner);
      formData.append('repo_name', repoName);

      const response = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = 'Failed to upload image';
        let isPaywall = response.status === 402;
        try {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
          if (errData.error === 'PAYWALL_REQUIRED') {
            isPaywall = true;
          }
        } catch (_) {}

        if (isPaywall && onPaywallTrigger) {
          onPaywallTrigger(errorMsg);
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      if (!data.success || !data.url) {
        throw new Error(data.error || 'Failed to parse upload URL');
      }

      // Schedule caption/alt-text update in the next frame once the image block is inserted
      if (data.altText) {
        setTimeout(() => {
          editor.forEachBlock((block) => {
            if (block.type === 'image' && block.props && block.props.url === data.url) {
              editor.updateBlock(block.id, {
                type: 'image',
                props: {
                  ...block.props,
                  name: data.altText
                }
              });
              return false; // Stop traversal
            }
            return true;
          });
        }, 100);
      }

      return data.url;
    }
  });

  // Listen to text selections in the editor
  useEffect(() => {
    const handleSelectionChange = () => {
      if (!containerRef.current) return;
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      
      // Verify selection is within our editor container
      if (text && containerRef.current.contains(selection?.anchorNode || null)) {
        setSelectedText(text);
      } else {
        // Only clear if the AI menu isn't open, to prevent losing focus during clicks
        if (!aiMenuOpen) {
          setSelectedText('');
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [aiMenuOpen]);

  // Call the Workers AI Assistant endpoint
  const handleAIAssist = async (action: string, param?: string) => {
    if (!selectedText) return;
    
    // Capture the ProseMirror selection/cursor state before awaiting fetch
    const savedSelection = editor._tiptapEditor.state.selection;
    
    setLoadingAI(true);
    setAiError('');

    try {
      const response = await fetch('/api/content/ai-assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: selectedText,
          action,
          tone: action === 'tone' ? param : undefined,
          targetLanguage: action === 'translate' ? param : undefined,
          repo_owner: repoOwner,
          repo_name: repoName,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success && data.result) {
        // Restore the saved selection on the editor
        editor._tiptapEditor.view.dispatch(
          editor._tiptapEditor.state.tr.setSelection(savedSelection)
        );
        editor._tiptapEditor.view.focus();

        // Replace the selection in BlockNote!
        editor.insertInlineContent(data.result);
        setAiMenuOpen(false);
        setSelectedText('');
      } else {
        const errorMsg = data.error || 'Failed to perform AI assistance.';
        if ((response.status === 402 || data.error === 'PAYWALL_REQUIRED') && onPaywallTrigger) {
          onPaywallTrigger(errorMsg);
        }
        setAiError(errorMsg);
      }
    } catch (err: any) {
      setAiError(err.message || 'An error occurred.');
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div ref={containerRef} className="blocknote-editor-wrapper relative w-full h-full min-h-[500px] text-left">
      
      {/* Inline AI Writing Assistant Floating Button */}
      {selectedText && (
        <div className="absolute top-2 right-4 z-40 flex flex-col items-end">
          <button
            className={`btn-floating-ai-assist ${aiMenuOpen ? 'active' : ''}`}
            onClick={() => {
              setAiMenuOpen(!aiMenuOpen);
              setActiveSubMenu('main');
              setAiError('');
            }}
          >
            <span className="sparkle-icon">✨</span>
            AI Writing Assist
            <span className="selection-badge">{selectedText.length > 20 ? `${selectedText.substring(0, 20)}...` : selectedText}</span>
          </button>

          {/* Premium Glassmorphic AI Dropdown Menu */}
          {aiMenuOpen && (
            <div className="ai-assist-dropdown-menu">
              {loadingAI ? (
                <div className="ai-loader-container">
                  <svg className="spin-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <span>AI Writing Assistant is drafting...</span>
                </div>
              ) : aiError ? (
                <div className="ai-error-container">
                  <span className="error-text">⚠️ {aiError}</span>
                  <button className="btn-ai-menu-back" onClick={() => setAiError('')}>Try Again</button>
                </div>
              ) : activeSubMenu === 'main' ? (
                <div className="ai-menu-options-list">
                  <button className="ai-menu-item" onClick={() => handleAIAssist('grammar')}>
                    <span className="menu-icon">📝</span>
                    <div className="menu-text-block">
                      <span className="menu-label">Grammar & Clarity</span>
                      <span className="menu-sublabel">Fix spelling, phrasing, and flow</span>
                    </div>
                  </button>
                  
                  <button className="ai-menu-item" onClick={() => setActiveSubMenu('tone')}>
                    <span className="menu-icon">🎭</span>
                    <div className="menu-text-block">
                      <span className="menu-label">Adjust Tone...</span>
                      <span className="menu-sublabel">Rewrite as Professional, Casual, Confident</span>
                    </div>
                  </button>

                  <button className="ai-menu-item" onClick={() => setActiveSubMenu('translate')}>
                    <span className="menu-icon">🌐</span>
                    <div className="menu-text-block">
                      <span className="menu-label">Translate Selection...</span>
                      <span className="menu-sublabel">Spanish, French, German, Japanese, Finnish</span>
                    </div>
                  </button>

                  <button className="ai-menu-item" onClick={() => handleAIAssist('summarize')}>
                    <span className="menu-icon">📊</span>
                    <div className="menu-text-block">
                      <span className="menu-label">Summarize</span>
                      <span className="menu-sublabel">Condense selection into high-impact summary</span>
                    </div>
                  </button>

                  <button className="ai-menu-item" onClick={() => handleAIAssist('expand')}>
                    <span className="menu-icon">💡</span>
                    <div className="menu-text-block">
                      <span className="menu-label">Continue Writing</span>
                      <span className="menu-sublabel">Generate the next sentences cohesively</span>
                    </div>
                  </button>
                </div>
              ) : activeSubMenu === 'tone' ? (
                <div className="ai-menu-options-list">
                  <div className="ai-submenu-header">
                    <button className="btn-ai-menu-back" onClick={() => setActiveSubMenu('main')}>← Back</button>
                    <span className="submenu-title">Select Tone</span>
                  </div>
                  {['Professional', 'Casual', 'Confident', 'Creative', 'Academic', 'Persuasive'].map((tone) => (
                    <button key={tone} className="ai-menu-item-simple" onClick={() => handleAIAssist('tone', tone)}>
                      {tone}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="ai-menu-options-list">
                  <div className="ai-submenu-header">
                    <button className="btn-ai-menu-back" onClick={() => setActiveSubMenu('main')}>← Back</button>
                    <span className="submenu-title">Select Language</span>
                  </div>
                  {[
                    { code: 'English', name: '🇬🇧 English' },
                    { code: 'Spanish', name: '🇪🇸 Spanish' },
                    { code: 'French', name: '🇫🇷 French' },
                    { code: 'German', name: '🇩🇪 German' },
                    { code: 'Japanese', name: '🇯🇵 Japanese' },
                    { code: 'Chinese', name: '🇨🇳 Chinese' },
                    { code: 'Finnish', name: '🇫🇮 Finnish' }
                  ].map((lang) => (
                    <button key={lang.code} className="ai-menu-item-simple text-left" onClick={() => handleAIAssist('translate', lang.code)}>
                      {lang.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* BlockNote Canvas */}
      <BlockNoteView
        editor={editor}
        onChange={() => {
          onChange(editor.document);
        }}
        theme="dark"
      />

      {/* Premium Inline Styles for Floating AI Assistant */}
      <style>{`
        .btn-floating-ai-assist {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
          background: linear-gradient(135deg, #7928CA 0%, #FF0080 100%);
          border: none;
          border-radius: 9999px;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(121, 40, 202, 0.4);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: breathing-glow 2.5s infinite alternate;
        }

        .btn-floating-ai-assist:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 6px 20px rgba(255, 0, 128, 0.6);
        }

        .btn-floating-ai-assist.active {
          background: #1e1e2d;
          border: 1px solid rgba(255, 0, 128, 0.5);
          box-shadow: 0 0 10px rgba(121, 40, 202, 0.2);
          animation: none;
        }

        .sparkle-icon {
          font-size: 14px;
          animation: rotate-sparkle 2.5s infinite linear;
        }

        .selection-badge {
          display: inline-block;
          padding: 2px 6px;
          font-size: 10px;
          font-weight: 500;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ai-assist-dropdown-menu {
          margin-top: 8px;
          width: 320px;
          background: rgba(15, 17, 26, 0.95);
          border: 1px solid rgba(121, 40, 202, 0.3);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(16px);
          overflow: hidden;
          animation: fade-in-slide 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .ai-loader-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 24px;
          color: #94a3b8;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          font-weight: 500;
        }

        .ai-error-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 16px;
          font-family: 'Plus Jakarta Sans', sans-serif;
        }

        .error-text {
          color: #ef4444;
          font-size: 12px;
          text-align: center;
        }

        .ai-menu-options-list {
          display: flex;
          flex-direction: column;
          padding: 6px;
        }

        .ai-menu-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          width: 100%;
          padding: 8px 10px;
          background: transparent;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .ai-menu-item:hover {
          background: rgba(121, 40, 202, 0.15);
        }

        .menu-icon {
          font-size: 16px;
          padding-top: 2px;
        }

        .menu-text-block {
          display: flex;
          flex-direction: column;
        }

        .menu-label {
          color: #f1f5f9;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12.5px;
          font-weight: 600;
        }

        .menu-sublabel {
          color: #64748b;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 10px;
          font-weight: 400;
          margin-top: 1px;
        }

        .ai-submenu-header {
          display: flex;
          align-items: center;
          padding: 6px 10px 10px 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          margin-bottom: 6px;
        }

        .submenu-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          font-weight: 700;
          color: #f1f5f9;
          margin-left: 12px;
        }

        .btn-ai-menu-back {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #7928CA;
          background: transparent;
          border: none;
          cursor: pointer;
          transition: color 0.2s ease;
        }

        .btn-ai-menu-back:hover {
          color: #ff0080;
        }

        .ai-menu-item-simple {
          width: 100%;
          padding: 8px 12px;
          color: #cbd5e1;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          font-weight: 500;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .ai-menu-item-simple:hover {
          background: rgba(121, 40, 202, 0.15);
          color: #ffffff;
          padding-left: 16px;
        }

        @keyframes breathing-glow {
          0% {
            box-shadow: 0 4px 12px rgba(121, 40, 202, 0.4);
          }
          100% {
            box-shadow: 0 4px 22px rgba(255, 0, 128, 0.7);
          }
        }

        @keyframes rotate-sparkle {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fade-in-slide {
          0% {
            opacity: 0;
            transform: translateY(-8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .spin-icon {
          animation: spin 1s linear infinite;
          stroke: #ff0080;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
