import React, { useState, useEffect, useMemo, useRef } from 'react';
import BlockNoteEditor from './BlockNoteEditor';
import { resolveWritePath } from '../utils/path';

// Simple ID generator for documents
const generateId = () => Math.random().toString(36).substring(2, 11);

interface UserProfile {
  authenticated: boolean;
  username?: string;
  name?: string;
  avatar_url?: string;
  html_url?: string;
}

interface GitRepo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  default_branch: string;
  github_installation_id: string;
}

interface DocumentDraft {
  id: string;
  type: string;
  slug: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface HydratedDocument {
  id: string;
  type: string;
  slug: string;
  title: string;
  status: string;
  content_json: string;
  metadata_json: string;
  created_at?: string;
  updated_at?: string;
}

interface ContentType {
  type: string;
  label: string;
  writePath?: string;
  fields?: any[];
}

interface DraftConfig {
  contentTypes: ContentType[];
}


function isFullyHydratedDocument(doc: unknown): doc is HydratedDocument {
  if (doc === null || typeof doc !== 'object') {
    return false;
  }
  return (
    'id' in doc && typeof (doc as Record<string, unknown>)['id'] === 'string' &&
    'type' in doc && typeof (doc as Record<string, unknown>)['type'] === 'string' &&
    'slug' in doc && typeof (doc as Record<string, unknown>)['slug'] === 'string' &&
    'title' in doc && typeof (doc as Record<string, unknown>)['title'] === 'string' &&
    'status' in doc && typeof (doc as Record<string, unknown>)['status'] === 'string' &&
    'content_json' in doc && typeof (doc as Record<string, unknown>)['content_json'] === 'string' &&
    'metadata_json' in doc && typeof (doc as Record<string, unknown>)['metadata_json'] === 'string'
  );
}

export default function CMSWorkspace(): React.ReactElement {
  // Auth state
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Connected installations & repositories state
  const [repos, setRepos] = useState<GitRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('main');
  const [githubInstallationId, setGithubInstallationId] = useState<string>('');
  const [loadingRepos, setLoadingRepos] = useState(false);

  // Stripe billing/paywall states
  const [subscriptionActive, setSubscriptionActive] = useState<boolean>(true);
  const [stripeCheckoutUrl, setStripeCheckoutUrl] = useState<string>('');
  const [stripePortalUrl, setStripePortalUrl] = useState<string>('');
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState<boolean>(false);
  const [checkingSubscription, setCheckingSubscription] = useState<boolean>(false);

  // Dynamic config loaded directly from GitHub repo
  const [activeConfig, setActiveConfig] = useState<DraftConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string>('');
  const [configMissing, setConfigMissing] = useState(false);

  // Isolated drafts fetched from D1 SQLite
  const [drafts, setDrafts] = useState<DocumentDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  // Active loaded document states
  const [docId, setDocId] = useState<string>('');
  const [activeType, setActiveType] = useState<string>('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [blocks, setBlocks] = useState<any[]>([]);
  const [metadata, setMetadata] = useState<Record<string, any>>({});
  const [status, setStatus] = useState('draft');
  const [isDraftHydrated, setIsDraftHydrated] = useState<boolean>(false);

  // UI status feedback
  const [saveStatus, setSaveStatus] = useState<'Saved' | 'Saving...' | 'Unsaved Changes' | 'Error' | 'Idle'>('Idle');
  const [publishStatus, setPublishStatus] = useState<'Idle' | 'Publishing...' | 'Published!' | 'Error'>('Idle');
  const [publishError, setPublishError] = useState('');
  const [uploadingFields, setUploadingFields] = useState<Set<string>>(new Set());
  const [generatingFields, setGeneratingFields] = useState<Record<string, boolean>>({});
  const [generatingHeadlines, setGeneratingHeadlines] = useState(false);
  const [headlineSuggestions, setHeadlineSuggestions] = useState<string[]>([]);
  const [headlinesOpen, setHeadlinesOpen] = useState(false);

  // Responsive mobile sidebar drawer state
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  // Media Library modal state
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);
  const [mediaImages, setMediaImages] = useState<any[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string>('');

  // References to keep state values strictly up-to-date in asynchronous closures (e.g. handleDeleteDraft)
  const docIdRef = useRef(docId);
  const lastRequestedDraftIdRef = useRef<string>('');
  const draftsRef = useRef(drafts);
  useEffect(() => { docIdRef.current = docId; }, [docId]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);

  // Ref for the media library close button (focus management) and copy confirmation timer
  const mediaLibraryCloseRef = useRef<HTMLButtonElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Move focus into modal on open, restore it on close; also handle Escape key
  useEffect(() => {
    if (!isMediaLibraryOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer so the modal is in the DOM before we focus
    const focusTimer = setTimeout(() => mediaLibraryCloseRef.current?.focus(), 0);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMediaLibraryOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isMediaLibraryOpen]);

  // Cleanup copy timeout on unmount
  useEffect(() => () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); }, []);

  // Track responsive screen breakpoints
  const [showSettingsToggle, setShowSettingsToggle] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkBreakpoint = () => {
      const isTablet = window.innerWidth >= 768 && window.innerWidth <= 1279;
      setShowSettingsToggle(!isTablet);
    };
    checkBreakpoint();
    window.addEventListener('resize', checkBreakpoint);
    return () => window.removeEventListener('resize', checkBreakpoint);
  }, []);

  // Checks authentication state on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        setUser(data);
        
        if (data.authenticated) {
          fetchUserInstallations();
        }
      } catch (err) {
        console.error('Failed to verify profile session:', err);
      } finally {
        setLoadingAuth(false);
      }
    };
    checkAuth();
  }, []);

  // Synchronize active workspace state back to URL query parameters
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selectedRepo) return; // Do not wipe URL parameters before repository is selected / loaded
    
    const url = new URL(window.location.href);
    let changed = false;
    
    if (url.searchParams.get('repo') !== selectedRepo) {
      url.searchParams.set('repo', selectedRepo);
      // If repository changed, we immediately clear the draft ID from the URL to avoid mismatched state
      url.searchParams.delete('draftId');
      changed = true;
    }
    
    if (selectedBranch && selectedBranch !== 'main') {
      if (url.searchParams.get('branch') !== selectedBranch) {
        url.searchParams.set('branch', selectedBranch);
        changed = true;
      }
    } else {
      if (url.searchParams.has('branch')) {
        url.searchParams.delete('branch');
        changed = true;
      }
    }
    
    // Only update draftId in the URL if the active draft is hydrated and loaded.
    // This prevents wiping the URL's draftId parameter during initial startup/loading.
    if (isDraftHydrated && docId) {
      if (url.searchParams.get('draftId') !== docId) {
        url.searchParams.set('draftId', docId);
        changed = true;
      }
    }
    
    if (changed) {
      window.history.pushState({}, '', url.pathname + url.search);
    }
  }, [selectedRepo, selectedBranch, docId, isDraftHydrated]);

  // Listen for browser back/forward navigation (popstate)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlRepo = urlParams.get('repo') || '';
      const urlBranch = urlParams.get('branch') || 'main';
      const urlDraftId = urlParams.get('draftId') || '';
      
      // 1. If repo changed in URL, update repository and load its assets
      if (urlRepo && urlRepo !== selectedRepo) {
        setSelectedRepo(urlRepo);
        localStorage.setItem('pouta_last_repo', urlRepo);
        const matched = repos.find(r => r.full_name === urlRepo);
        if (matched) {
          setSelectedBranch(urlBranch || matched.default_branch || 'main');
          setGithubInstallationId(matched.github_installation_id);
        }
        // Clear active doc so we fetch fresh config & drafts
        setDocId('');
        setActiveConfig(null);
      }
      
      // 2. If draftId changed in URL, load it
      if (urlDraftId !== docId) {
        // Guard: If the repository is also changing in this popstate event, do not load the draft here.
        // The repository state update will trigger fetching the new repository's drafts, which will 
        // automatically load the correct draft from the URL once fetched.
        if (urlRepo && urlRepo !== selectedRepo) {
          return;
        }

        if (urlDraftId) {
          // If the draft is in our currently loaded drafts list, load it.
          // Otherwise, fetch it.
          const matched = drafts.find(d => d.id === urlDraftId);
          if (matched) {
            handleLoadDraftInWorkspace(urlDraftId, drafts);
          } else {
            setIsDraftHydrated(false);
            fetchFullDocumentDetail(urlDraftId);
          }
        } else {
          setDocId('');
        }
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedRepo, docId, repos, drafts]);

  // Fetch installed repositories
  const fetchUserInstallations = async () => {
    setLoadingRepos(true);
    try {
      const response = await fetch('/api/github/repos');
      const data = await response.json();
      if (data.success && data.repos && data.repos.length > 0) {
        setRepos(data.repos);
        
        // Select repo/branch from URL query parameters if present, otherwise fallback to localStorage/first repo
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const urlRepo = urlParams ? urlParams.get('repo') : null;
        const urlBranch = urlParams ? urlParams.get('branch') : null;
        
        const savedRepo = typeof window !== 'undefined' ? localStorage.getItem('pouta_last_repo') : null;
        const matchedSaved = urlRepo 
          ? data.repos.find((r: any) => r.full_name === urlRepo)
          : (savedRepo ? data.repos.find((r: any) => r.full_name === savedRepo) : null);
        
        if (matchedSaved) {
          setSelectedRepo(matchedSaved.full_name);
          setSelectedBranch(urlBranch || matchedSaved.default_branch || 'main');
          setGithubInstallationId(matchedSaved.github_installation_id);
          if (typeof window !== 'undefined' && !urlRepo) {
            localStorage.setItem('pouta_last_repo', matchedSaved.full_name);
          }
        } else {
          const firstRepo = data.repos[0];
          setSelectedRepo(firstRepo.full_name);
          setSelectedBranch(firstRepo.default_branch || 'main');
          setGithubInstallationId(firstRepo.github_installation_id);
          if (typeof window !== 'undefined') {
            localStorage.setItem('pouta_last_repo', firstRepo.full_name);
          }
        }
      }
    } catch (err) {
      console.error('Failed to retrieve connected repositories:', err);
    } finally {
      setLoadingRepos(false);
    }
  };

  // Sync workspace properties when switching active repositories
  const handleRepoChange = (repoFullName: string) => {
    if (repoFullName === selectedRepo) return;
    setSelectedRepo(repoFullName);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pouta_last_repo', repoFullName);
    }
    const matched = repos.find(r => r.full_name === repoFullName);
    if (matched) {
      setSelectedBranch(matched.default_branch || 'main');
      setGithubInstallationId(matched.github_installation_id);
    }
    // Clear the active document loader until new workspace assets load
    setDocId('');
    setActiveConfig(null);
  };

  // Fetch repository billing/paywall status when switching workspace
  useEffect(() => {
    if (!selectedRepo) return;

    // Reset billing/paywall states immediately when new repo loads to prevent retaining prior workspace value
    setSubscriptionActive(false);
    setStripeCheckoutUrl('');
    setStripePortalUrl('');
    setIsUpgradeModalOpen(false);
    setCheckingSubscription(true);

    const checkWorkspaceSubscription = async () => {
      try {
        const response = await fetch(`/api/subscription/status?repo=${encodeURIComponent(selectedRepo)}`);
        const data = await response.json();
        if (data.success) {
          setSubscriptionActive(data.active);
          setStripeCheckoutUrl(data.checkoutUrl);
          setStripePortalUrl(data.portalUrl || '');
        } else {
          setSubscriptionActive(true); // Fail-open locally to avoid lockouts
        }
      } catch (err) {
        console.error('Failed to retrieve workspace billing details:', err);
        setSubscriptionActive(true);
      } finally {
        setCheckingSubscription(false);
      }
    };

    checkWorkspaceSubscription();
  }, [selectedRepo]);

  // Handle redirect to static Stripe-hosted Customer Portal
  const handleBillingPortalRedirect = () => {
    if (stripePortalUrl) {
      window.open(stripePortalUrl, '_blank');
    } else {
      alert('Billing portal is not configured in environment.');
    }
  };

  // Dynamic GitOps Schema Loader: Fetch pouta.config.json from target repository root
  useEffect(() => {
    if (!selectedRepo || !githubInstallationId) return;

    const loadGitOpsConfig = async () => {
      setLoadingConfig(true);
      setConfigError('');
      setConfigMissing(false);
      try {
        const response = await fetch(
          `/api/content/config?repo=${encodeURIComponent(selectedRepo)}&installationId=${githubInstallationId}`
        );
        const data = await response.json();
        
        if (data.success && data.config && data.config.contentTypes) {
          setActiveConfig(data.config);
          
          // Set the first content type inside the loaded config as active
          const firstType = data.config.contentTypes[0];
          setActiveType(firstType.type);
          
          // Fetch isolated D1 drafts for this repository, passing the loaded config to prevent React state update lag
          fetchIsolatedDrafts(selectedRepo, data.config);
        } else if (response.status === 404 && data.notFound) {
          setConfigMissing(true);
        } else {
          setConfigError(data.error || 'Failed to load dynamic GitOps schema configurations.');
        }
      } catch (err) {
        setConfigError('Network error loading schema configurations.');
      } finally {
        setLoadingConfig(false);
      }
    };

    loadGitOpsConfig();
  }, [selectedRepo, githubInstallationId]);

  // Fetch D1 draft lists isolated strictly by active repository scope
  const fetchIsolatedDrafts = async (repoFullName: string, configToUse?: DraftConfig) => {
    setLoadingDrafts(true);
    try {
      const response = await fetch(`/api/content/list?repo=${encodeURIComponent(repoFullName)}`);
      const data = await response.json();
      if (data.success && data.documents) {
        setDrafts(data.documents);
        
        // Check if there is a draft ID in URL parameters
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const urlDraftId = urlParams ? urlParams.get('draftId') : null;
        
        // If drafts exist, load the target URL draft or default to the latest updated one automatically
        if (data.documents.length > 0) {
          let targetDraft = null;
          if (urlDraftId) {
            targetDraft = data.documents.find((d: any) => d && typeof d === 'object' && 'id' in d && d.id === urlDraftId);
            if (!targetDraft) {
              console.warn(`Requested draft ID "${urlDraftId}" was not found in repository "${repoFullName}".`);
              alert(`The requested draft was not found in this repository workspace. Loading the latest draft instead.`);
            }
          }
          const docToLoad = targetDraft || data.documents[0];
          
          if (isFullyHydratedDocument(docToLoad)) {
            handleLoadDraftInWorkspace(docToLoad.id, data.documents);
          } else {
            setIsDraftHydrated(false);
            lastRequestedDraftIdRef.current = docToLoad.id;
            fetchFullDocumentDetail(docToLoad.id);
          }
        } else {
          // If no drafts exist, prepare a fresh draft
          handleCreateNewDraft(configToUse);
        }
      }
    } catch (err) {
      console.error('Failed to load isolated drafts:', err);
    } finally {
      setLoadingDrafts(false);
    }
  };

  // Load full document details from D1 if they are missing from list
  const fetchFullDocumentDetail = async (draftId: string) => {
    // 1. First look up the draft in existing draftsRef.current
    const localMatched: unknown = draftsRef.current.find((d) => d.id === draftId);
    if (isFullyHydratedDocument(localMatched)) {
      setSaveStatus('Idle');
      setDocId(localMatched.id);
      setActiveType(localMatched.type);
      setTitle(localMatched.title);
      setSlug(localMatched.slug);
      setStatus(localMatched.status);

      try {
        setBlocks(JSON.parse(localMatched.content_json));
      } catch (e) {
        setBlocks([]);
      }

      try {
        setMetadata(JSON.parse(localMatched.metadata_json));
      } catch (e) {
        setMetadata({});
      }
      setIsDraftHydrated(true);
      return;
    }

    // 2. Fallback to fetch
    const reqRepo = selectedRepo;
    const reqDraftId = draftId;
    lastRequestedDraftIdRef.current = draftId;

    try {
      const response = await fetch(`/api/content/list?repo=${encodeURIComponent(selectedRepo)}`);
      const data = await response.json();

      // Guard against stale response
      if (selectedRepo !== reqRepo || lastRequestedDraftIdRef.current !== reqDraftId) {
        return;
      }

      if (data.success && data.documents) {
        setDrafts(data.documents);
        const matched: unknown = data.documents.find((d: unknown) => {
          return d !== null && typeof d === 'object' && 'id' in d && d.id === draftId;
        });
        if (isFullyHydratedDocument(matched)) {
          setSaveStatus('Idle');
          setDocId(matched.id);
          setActiveType(matched.type);
          setTitle(matched.title);
          setSlug(matched.slug);
          setStatus(matched.status);

          try {
            setBlocks(JSON.parse(matched.content_json));
          } catch (e) {
            setBlocks([]);
          }

          try {
            setMetadata(JSON.parse(matched.metadata_json));
          } catch (e) {
            setMetadata({});
          }
          setIsDraftHydrated(true);
        }
      }
    } catch (err) {
      console.error('Failed to fetch full document details:', err);
    }
  };

  const handleLoadDraftInWorkspace = (draftId: string, currentDraftsList?: DocumentDraft[]) => {
    const listToSearch = currentDraftsList || draftsRef.current;
    const matched: unknown = listToSearch.find((d) => d.id === draftId);
    if (!matched) return;

    lastRequestedDraftIdRef.current = draftId;

    if (isFullyHydratedDocument(matched)) {
      setSaveStatus('Idle');
      setDocId(matched.id);
      setActiveType(matched.type);
      setTitle(matched.title);
      setSlug(matched.slug);
      setStatus(matched.status);

      try {
        setBlocks(JSON.parse(matched.content_json));
      } catch (e) {
        setBlocks([]);
      }

      try {
        setMetadata(JSON.parse(matched.metadata_json));
      } catch (e) {
        setMetadata({});
      }
      setIsDraftHydrated(true);
    } else {
      setIsDraftHydrated(false);
      fetchFullDocumentDetail(draftId);
    }
  };

  // Delete an existing draft from D1 SQLite edge database
  const handleDeleteDraft = async (draftId: string, draftTitle: string) => {
    const confirmMessage = `Are you sure you want to delete the draft "${draftTitle || 'Untitled Draft'}"?\nThis action cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    try {
      const [owner, name] = selectedRepo.split('/');
      const response = await fetch('/api/content/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftId,
          repo_owner: owner,
          repo_name: name,
        }),
      });

      const data = await response.json();
      if (data.success) {
        const changes = data.meta?.changes ?? 0;
        if (changes > 0) {
          // Use refs to get the absolute latest values post-await
          const latestDocId = docIdRef.current;
          const latestDrafts = draftsRef.current;

          // Find if we deleted the active document
          const isCurrent = latestDocId === draftId;
          
          // Filter out the deleted draft from the state so UI updates instantly
          const remainingDrafts = latestDrafts.filter((d) => d.id !== draftId);
          setDrafts(remainingDrafts);

          if (isCurrent) {
            if (remainingDrafts.length > 0) {
              // Load the first available remaining draft
              handleLoadDraftInWorkspace(remainingDrafts[0].id, remainingDrafts);
            } else {
              // Start a fresh new draft if no drafts are left
              handleCreateNewDraft();
            }
          }
        } else {
          console.warn('Delete operation succeeded but 0 database rows were changed.');
          alert('Draft deletion could not be completed (the draft may have already been deleted).');
        }
      } else {
        alert(`Failed to delete draft: ${data.error}`);
      }
    } catch (err) {
      console.error('Delete draft error:', err);
      alert('An error occurred while deleting the draft.');
    }
  };

  // Create a brand new draft within the active repository scope
  const handleCreateNewDraft = (configParam?: DraftConfig) => {
    // Prevent event objects from being treated as configuration objects when handler is passed to onClick directly
    const isValidConfig = configParam && typeof configParam === 'object' && 'contentTypes' in configParam;
    const configToUse = isValidConfig ? configParam : activeConfig;
    if (!configToUse || !configToUse.contentTypes || configToUse.contentTypes.length === 0) return;

    setSaveStatus('Idle');
    const newId = generateId();
    setDocId(newId);
    
    // Default to the first configured content type
    const firstType = configToUse.contentTypes[0];
    setActiveType(firstType.type);
    
    setTitle(`Draft ${newTypeLabel(firstType.type)} Entry`);
    setSlug(`draft-${firstType.type}-entry-${newId}`);
    setStatus('draft');
    setMetadata({});

    setBlocks([
      {
        id: `p-${newId}`,
        type: 'paragraph',
        props: {},
        content: []
      }
    ]);
    setIsDraftHydrated(true);
  };

  const newTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // Switch schema content type of the active draft
  const handleActiveTypeChange = (newType: string) => {
    setActiveType(newType);
    setTitle(`Draft ${newTypeLabel(newType)} Entry`);
    setSlug(`draft-${newType}-entry-${docId}`);
    setMetadata({});
    setBlocks([
      {
        id: `p-switch-${newType}`,
        type: 'paragraph',
        props: {},
        content: []
      }
    ]);
    setIsDraftHydrated(true);
  };

  // Auto-generate Slug on Title change
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    const generated = newTitle
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setSlug(generated);

    // Also auto-generate any metadata fields of type 'slug'
    const slugFields = activeFields.filter((f: any) => f.type === 'slug');
    if (slugFields.length > 0) {
      setMetadata(prev => {
        const nextMeta = { ...prev };
        slugFields.forEach((field: any) => {
          const oldGenerated = title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_]+/g, '-')
            .replace(/^-+|-+$/g, '');
          
          const currentValue = nextMeta[field.name];
          if (!currentValue || currentValue === oldGenerated) {
            nextMeta[field.name] = generated;
          }
        });
        return nextMeta;
      });
    }
  };

  // Handle dynamic form inputs
  const handleMetadataChange = (key: string, value: any) => {
    setMetadata(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Generate description using Cloudflare Workers GenAI
  const handleGenerateDescription = async (fieldName: string) => {
    const getText = (contentArr: any[]): string => {
      if (!contentArr || !Array.isArray(contentArr)) return '';
      return contentArr.map(item => item.text || '').join('');
    };
    
    const blocksToPlainText = (items: any[]): string => {
      if (!items || !Array.isArray(items)) return '';
      return items.map(item => {
        const textVal = getText(item.content);
        let md = textVal;
        if (item.children && Array.isArray(item.children)) {
          md += '\n' + blocksToPlainText(item.children);
        }
        return md;
      }).join('\n');
    };

    const textContent = blocksToPlainText(blocks).trim();

    if (!textContent) {
      alert('Cannot generate description: The document body has no text content.');
      return;
    }

    const [owner, name] = selectedRepo ? selectedRepo.split('/') : ['', ''];
    const capturedDocId = docId;
    setGeneratingFields(prev => ({ ...prev, [fieldName]: true }));

    try {
      const response = await fetch('/api/content/generate-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          content: textContent,
          repo_owner: owner,
          repo_name: name,
        }),
      });

      const data = await response.json();
      if (response.status === 402 || data.error === 'PAYWALL_REQUIRED') {
        setIsUpgradeModalOpen(true);
        return;
      }

      if (response.ok && data.success && data.description) {
        if (docIdRef.current !== capturedDocId) {
          console.warn('Abandoning AI description generation: Draft has switched.');
          return;
        }
        handleMetadataChange(fieldName, data.description);
      } else {
        alert(data.error || 'Failed to automatically generate description.');
      }
    } catch (err: any) {
      alert(err.message || 'An error occurred while generating the description.');
    } finally {
      setGeneratingFields(prev => ({ ...prev, [fieldName]: false }));
    }
  };

  // Generate categories using Cloudflare Workers GenAI
  const handleGenerateCategories = async (fieldName: string) => {
    const getText = (contentArr: any[]): string => {
      if (!contentArr || !Array.isArray(contentArr)) return '';
      return contentArr.map(item => item.text || '').join('');
    };
    
    const blocksToPlainText = (items: any[]): string => {
      if (!items || !Array.isArray(items)) return '';
      return items.map(item => {
        const textVal = getText(item.content);
        let md = textVal;
        if (item.children && Array.isArray(item.children)) {
          md += '\n' + blocksToPlainText(item.children);
        }
        return md;
      }).join('\n');
    };

    const textContent = blocksToPlainText(blocks).trim();

    if (!textContent) {
      alert('Cannot generate categories: The document body has no text content.');
      return;
    }

    const [owner, name] = selectedRepo ? selectedRepo.split('/') : ['', ''];
    const capturedDocId = docId;
    setGeneratingFields(prev => ({ ...prev, [fieldName]: true }));

    try {
      const response = await fetch('/api/content/generate-categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          content: textContent,
          repo_owner: owner,
          repo_name: name,
        }),
      });

      const data = await response.json();
      if (response.status === 402 || data.error === 'PAYWALL_REQUIRED') {
        setIsUpgradeModalOpen(true);
        return;
      }

      if (response.ok && data.success && Array.isArray(data.categories)) {
        if (docIdRef.current !== capturedDocId) {
          console.warn('Abandoning AI categories generation: Draft has switched.');
          return;
        }
        handleMetadataChange(fieldName, data.categories.join(', '));
      } else {
        alert(data.error || 'Failed to automatically generate categories.');
      }
    } catch (err: any) {
      alert(err.message || 'An error occurred while generating categories.');
    } finally {
      setGeneratingFields(prev => ({ ...prev, [fieldName]: false }));
    }
  };

  // Generate SEO headlines using Cloudflare Workers GenAI
  const handleGenerateHeadlines = async () => {
    const getText = (contentArr: any[]): string => {
      if (!contentArr || !Array.isArray(contentArr)) return '';
      return contentArr.map(item => item.text || '').join('');
    };
    
    const blocksToPlainText = (items: any[]): string => {
      if (!items || !Array.isArray(items)) return '';
      return items.map(item => {
        const textVal = getText(item.content);
        let md = textVal;
        if (item.children && Array.isArray(item.children)) {
          md += '\n' + blocksToPlainText(item.children);
        }
        return md;
      }).join('\n');
    };

    const textContent = blocksToPlainText(blocks).trim();

    if (!textContent) {
      alert('Cannot generate headlines: The document body has no text content.');
      return;
    }

    const [owner, name] = selectedRepo ? selectedRepo.split('/') : ['', ''];
    const capturedDocId = docId;
    setGeneratingHeadlines(true);
    setHeadlineSuggestions([]);
    setHeadlinesOpen(true);

    try {
      const response = await fetch('/api/content/generate-headlines', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: textContent,
          repo_owner: owner,
          repo_name: name,
        }),
      });

      const data = await response.json();
      
      if (response.status === 402 || data.error === 'PAYWALL_REQUIRED') {
        setHeadlinesOpen(false);
        setIsUpgradeModalOpen(true);
        return;
      }
      
      // Abort silently if draft switched
      if (docIdRef.current !== capturedDocId) {
        console.warn('Abandoning AI headlines generation: Draft has switched.');
        return;
      }

      if (response.ok && data.success && Array.isArray(data.headlines)) {
        setHeadlineSuggestions(data.headlines);
      } else {
        alert(data.error || 'Failed to suggest headline recommendations.');
        setHeadlinesOpen(false);
      }
    } catch (err: any) {
      if (docIdRef.current === capturedDocId) {
        alert(err.message || 'An error occurred while generating headlines.');
        setHeadlinesOpen(false);
      }
    } finally {
      if (docIdRef.current === capturedDocId) {
        setGeneratingHeadlines(false);
      }
    }
  };

  // Fetch all uploaded images for the current repo from R2 (via list API)
  const handleOpenMediaLibrary = async () => {
    if (!selectedRepo) {
      alert('Please select a repository workspace first.');
      return;
    }
    const [owner, name] = selectedRepo.split('/');
    setIsMediaLibraryOpen(true);
    setLoadingMedia(true);
    setMediaError('');
    try {
      const response = await fetch(
        `/api/images/list?repo_owner=${encodeURIComponent(owner)}&repo_name=${encodeURIComponent(name)}`
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load media library.');
      }
      setMediaImages(data.images || []);
    } catch (err: any) {
      setMediaError(err.message || 'Failed to load images.');
    } finally {
      setLoadingMedia(false);
    }
  };

  // Delete an image from R2 via delete API
  const handleDeleteMediaImage = async (key: string) => {
    if (!selectedRepo) return;
    if (!confirm('Permanently delete this image from storage? This cannot be undone.')) return;
    const [owner, name] = selectedRepo.split('/');
    setDeletingKeys(prev => new Set(prev).add(key));
    try {
      const response = await fetch('/api/images/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, repo_owner: owner, repo_name: name }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete image.');
      }
      setMediaImages(prev => prev.filter(img => img.key !== key));
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingKeys(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  // Copy image URL to clipboard; cancel any in-flight confirmation timer first
  const handleCopyImageUrl = (url: string, key: string) => {
    navigator.clipboard.writeText(url).then(() => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopiedKey(key);
      copyTimeoutRef.current = setTimeout(() => setCopiedKey(''), 2000);
    });
  };

  // Handle R2 image uploads for declarative settings fields
  const handleMetadataImageUpload = async (fieldName: string, file: File) => {
    if (!file) return;
    const [owner, name] = selectedRepo ? selectedRepo.split('/') : ['', ''];
    if (!owner || !name) {
      alert('Please select a repository workspace first.');
      return;
    }

    setUploadingFields(prev => new Set(prev).add(fieldName));
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('repo_owner', owner);
      formData.append('repo_name', name);

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

        if (isPaywall) {
          setIsUpgradeModalOpen(true);
          return;
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      if (!data.success || !data.url) {
        throw new Error(data.error || 'Failed to parse upload URL');
      }

      handleMetadataChange(fieldName, data.url);

      // Auto-fill companion alt-text / caption fields in frontmatter metadata if they exist
      const possibleAltNames = [`${fieldName}_alt`, `${fieldName}_caption`, 'alt', 'caption', 'image_alt', `${fieldName}Alt`];
      const fields = activeConfig?.contentTypes?.find((c: ContentType) => c.type === activeType)?.fields || [];
      const altField = fields.find((f: any) => possibleAltNames.includes(f.name));
      if (altField && data.altText) {
        handleMetadataChange(altField.name, data.altText);
      }
    } catch (err: any) {
      console.error('Error uploading metadata image:', err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingFields(prev => { const next = new Set(prev); next.delete(fieldName); return next; });
    }
  };

  // Dynamic D1 isolated Autosave debouncer
  useEffect(() => {
    if (!user || !user.authenticated || !docId || !selectedRepo || !activeType || !isDraftHydrated) return;

    setSaveStatus('Unsaved Changes');

    const [owner, name] = selectedRepo.split('/');

    const debounceTimer = setTimeout(async () => {
      setSaveStatus('Saving...');
      try {
        const response = await fetch('/api/content/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: docId,
            type: activeType,
            slug,
            title,
            content_json: blocks,
            metadata_json: metadata,
            status,
            repo_owner: owner,
            repo_name: name,
            repo_branch: selectedBranch,
            github_installation_id: githubInstallationId
          })
        });

        const data = await response.json();
        if (data.success) {
          setSaveStatus('Saved');
          
          // Refresh list to show updated titles or new drafts instantly
          refreshDraftListSilence();
        } else {
          setSaveStatus('Error');
          console.error('Autosave error:', data.error);
        }
      } catch (err) {
        setSaveStatus('Error');
        console.error('Autosave network error:', err);
      }
    }, 1200);

    return () => clearTimeout(debounceTimer);
  }, [docId, title, slug, blocks, metadata, activeType, selectedRepo, selectedBranch, status, user, githubInstallationId, isDraftHydrated]);

  // Refresh lists silently to preserve editor focus
  const refreshDraftListSilence = async () => {
    if (!selectedRepo) return;
    try {
      const response = await fetch(`/api/content/list?repo=${encodeURIComponent(selectedRepo)}`);
      const data = await response.json();
      if (data.success && data.documents) {
        setDrafts(data.documents);
      }
    } catch (e) {
      console.warn('Silent drafts list refresh failed.');
    }
  };

  // Publish dynamic GitOps collection to GitHub App installation
  const handlePublish = async () => {
    setPublishStatus('Publishing...');
    setPublishError('');
    try {
      const [owner, name] = selectedRepo.split('/');

      // 1. Force a local save with status='published'
      const saveResponse = await fetch('/api/content/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: docId,
          type: activeType,
          slug,
          title,
          content_json: blocks,
          metadata_json: metadata,
          status: 'published',
          repo_owner: owner,
          repo_name: name,
          repo_branch: selectedBranch,
          github_installation_id: githubInstallationId
        })
      });

      const saveData = await saveResponse.json();
      if (!saveData.success) {
        throw new Error(saveData.error || 'Failed to save changes before publishing.');
      }

      // 2. Trigger edge publisher
      const publishResponse = await fetch('/api/content/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId })
      });

      const publishData = await publishResponse.json();
      if (publishData.success) {
        setPublishStatus('Published!');
        setStatus('published');
        refreshDraftListSilence();
        setTimeout(() => setPublishStatus('Idle'), 4000);
      } else {
        setPublishStatus('Error');
        setPublishError(publishData.error || 'Failed to publish commit.');
      }
    } catch (err: any) {
      setPublishStatus('Error');
      setPublishError(err.message || 'An error occurred during Git publication.');
    }
  };

  // Find dynamic field configurations
  const activeFields = useMemo(() => {
    if (!activeConfig || !activeConfig.contentTypes) return [];
    const typeObj = activeConfig.contentTypes.find((t: ContentType) => t.type === activeType);
    return typeObj ? (typeObj.fields || []) : [];
  }, [activeConfig, activeType]);

  const activeTypeLabel = useMemo(() => {
    if (!activeConfig || !activeConfig.contentTypes) return 'Document';
    const typeObj = activeConfig.contentTypes.find((t: ContentType) => t.type === activeType);
    return typeObj ? typeObj.label : 'Document';
  }, [activeConfig, activeType]);

  const resolvedOutputPath = useMemo(() => {
    if (!activeConfig || !activeType || !docId) return '';
    const typeObj = activeConfig.contentTypes?.find((t: ContentType) => t.type === activeType);
    const draft = drafts.find((d) => d.id === docId);
    return resolveWritePath(typeObj?.writePath, slug, metadata, draft?.created_at);
  }, [activeConfig, activeType, docId, slug, metadata, drafts]);

  // ----------------------------------------------------
  // Loader Indicator State
  // ----------------------------------------------------
  // ----------------------------------------------------
  // Dynamic UI Render Router (Guarantees Styles are Always Mounted)
  // ----------------------------------------------------
  return (
    <>
      {loadingAuth ? (
        <div className="login-screen">
          <div className="login-card text-center">
            <div className="spinner-large"></div>
            <p className="mt-4 text-slate-400">Verifying profile session...</p>
          </div>
        </div>
      ) : !user || !user.authenticated ? (
        <div className="login-screen">
          <div className="login-card">
            <div className="brand-header text-center">
              <img src="/logo.svg" alt="Pouta Logo" className="login-logo-img" />
              <h1 className="login-brand-title">pouta</h1>
              <span className="logo-badge">Headless CMS</span>
            </div>

            <p className="login-intro">
              A secure, multi-tenant Git-Backed Headless CMS running entirely on Cloudflare edge serverless computing. Lock your workspace globally, load repository-hosted GitOps config schemas, and push commits natively.
            </p>

            <a href="/api/auth/login" className="btn-login-github">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"></path>
              </svg>
              Sign in with GitHub
            </a>
          </div>
        </div>
      ) : (
        <div className="cms-layout">
      {/* Top Header Bar */}
      <header className="cms-header">
        <div className="header-logo">
          <img src="/logo.svg" alt="Pouta Logo" className="logo-img" />
          <span className="logo-text">pouta</span>
          <span className="logo-badge">Headless CMS</span>
        </div>

        {/* Global Repository Workspace selector */}
        <div className="workspace-site-selector-wrapper">
          <label className="site-select-label">Workspace:</label>
          {loadingRepos ? (
            <span className="text-slate-400 text-xs">Loading sites...</span>
          ) : (
            <select
              className="site-select"
              value={selectedRepo}
              onChange={(e) => handleRepoChange(e.target.value)}
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.full_name}>
                  {repo.full_name}
                </option>
              ))}
            </select>
          )}

          {/* Subscription Status Pill */}
          {selectedRepo && !checkingSubscription && (
            <span className={`billing-status-pill ${subscriptionActive ? 'active' : 'free'}`}>
              {subscriptionActive ? (
                <button 
                  className="billing-portal-trigger" 
                  onClick={handleBillingPortalRedirect} 
                  title="Manage Subscription, Cards & Invoices"
                >
                  👑 Pro
                </button>
              ) : (
                <button className="billing-upgrade-trigger" onClick={() => setIsUpgradeModalOpen(true)}>
                  ⚡ Upgrade
                </button>
              )}
            </span>
          )}
          <a
            href="https://github.com/apps/pouta-cms/installations/new"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-add-repo"
            title="Connect a new repository"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Repo
          </a>
        </div>
        
        <div className="header-actions">
           {/* Mobile: Drafts sidebar toggle */}
           {activeConfig && (
             <button className="btn-mobile-sidebar-toggle" onClick={() => { setDraftsOpen(o => !o); setMetaOpen(false); }} title="Drafts" aria-label="Toggle drafts">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                 <polyline points="14 2 14 8 20 8"/>
               </svg>
             </button>
           )}
 
           {/* Edge Autosave status */}
           {activeConfig && (
             <div className="status-pill-container">
               <div className={`status-pill status-${saveStatus.toLowerCase().replace(' ', '-')}`}>
                 <span className="status-dot"></span>
                 <span className="status-label">{saveStatus}</span>
               </div>
             </div>
           )}
 
           {/* Mobile: Metadata sidebar toggle */}
           {activeConfig && showSettingsToggle && (
             <button className="btn-mobile-sidebar-toggle" onClick={() => { setMetaOpen(o => !o); setDraftsOpen(false); }} title="Settings" aria-label="Toggle settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          )}

          {/* Media Library button */}
          {selectedRepo && (
            <button
              className="btn-media-library"
              onClick={handleOpenMediaLibrary}
              title="Browse & manage uploaded images"
              aria-label="Open Media Library"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span className="btn-media-label">Media</span>
            </button>
          )}

          {/* Sticky Header Publish Button */}
          {selectedRepo && docId && (
            <div className="relative flex items-center">
              <button
                className={`btn-header-publish btn-header-publish-${publishStatus.toLowerCase().replace('!', '')}`}
                onClick={handlePublish}
                disabled={publishStatus === 'Publishing...'}
                title={`Push updates to ${selectedRepo} on branch ${selectedBranch}`}
              >
                {publishStatus === 'Publishing...' ? (
                  <>
                    <span className="spinner-mini mr-1" style={{ borderTopColor: 'var(--text-light)', borderLeftColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: 'transparent' }} />
                    Syncing...
                  </>
                ) : publishStatus === 'Published!' ? (
                  'Published! 🎉'
                ) : publishStatus === 'Error' ? (
                  'Error ⚠️'
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Publish
                  </>
                )}
              </button>

              {/* Glassmorphic Alert Popover for Publication Failures */}
              {publishStatus === 'Error' && publishError && (
                <div className="header-publish-error-popup">
                  <div className="header-publish-error-header">
                    <span>⚠️ Publication Failure</span>
                    <button className="btn-close-error-popup" onClick={() => setPublishStatus('Idle')}>×</button>
                  </div>
                  <div className="header-publish-error-body">
                    {publishError}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* User Profile avatar */}
          <div className="user-profile-badge">
            <img src={user.avatar_url} alt={user.name} className="user-avatar" />
            <span className="user-name">{user.name}</span>
            <a href="/api/auth/logout" className="btn-logout" title="Sign Out">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Renders if there are no Connected Installations */}
      {repos.length === 0 && !loadingRepos && (
        <div className="no-installations-container">
          <div className="no-installations-card">
            <div className="no-inst-icon">☀️</div>
            <h2>Install Pouta on GitHub</h2>
            <p>
              Pouta is a SaaS-First Headless CMS. To write content, you must install the Pouta GitHub App on your target website repositories and authorize permissions.
            </p>
            <a 
              href="https://github.com/apps/pouta-cms/installations/new" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn-install-app"
            >
              Connect Repositories on GitHub
            </a>
            <button className="btn-refresh-repos" onClick={fetchUserInstallations}>
              Refresh Connected Repositories
            </button>
          </div>
        </div>
      )}

      {/* Renders while loading target GitOps config */}
      {repos.length > 0 && loadingConfig && (
        <div className="loading-config-container">
          <div className="spinner-large"></div>
          <p className="mt-4 text-slate-400">Loading website GitOps schemas directly from GitHub...</p>
        </div>
      )}

      {/* Renders if pouta.config.json is missing in the repository (ELITE GitOps DevUX Helper) */}
      {repos.length > 0 && configMissing && !loadingConfig && (
        <div className="config-missing-container">
          <div className="config-missing-card">
            <div className="config-err-icon">⚙️</div>
            <h2>pouta.config.json Not Found</h2>
            <p>
              Your connected repository `<strong>{selectedRepo}</strong>` does not have a schema configuration file. Please commit a `<strong>pouta.config.json</strong>` file at the root of your repository so Pouta can render your editing sidebars.
            </p>
            <div className="code-block-helper">
              <div className="code-block-header">Example pouta.config.json</div>
              <pre>
{`{
  "contentTypes": [
    {
      "type": "posts",
      "label": "Blog Posts",
      "writePath": "content/posts/{slug}.md",
      "fields": [
        { "name": "layout", "label": "Layout", "type": "select", "options": ["post", "page"] },
        { "name": "author", "label": "Author", "type": "select", "options": ["moha", "other-author"] },
        { "name": "categories", "label": "Categories", "type": "list" },
        { "name": "featured_image_url", "label": "Featured Image", "type": "image" },
        { "name": "slug", "label": "SEO Slug (Optional)", "type": "slug" },
        { "name": "seo_title", "label": "SEO Title", "type": "text" },
        { "name": "seo_description", "label": "SEO Description", "type": "description" }
      ]
    }
  ]
}`}
              </pre>
            </div>
            <button className="btn-refresh-repos" onClick={() => setSelectedRepo(selectedRepo)}>
              Reload Configuration Schema
            </button>
          </div>
        </div>
      )}

      {/* Renders if other schema config fetching errors occur */}
      {repos.length > 0 && configError && !loadingConfig && (
        <div className="config-error-container">
          <div className="config-missing-card">
            <div className="config-err-icon">⚠️</div>
            <h2>Failed to Load Configurations</h2>
            <p className="text-red-400">{configError}</p>
            <button className="btn-refresh-repos" onClick={() => setSelectedRepo(selectedRepo)}>
              Try Loading Again
            </button>
          </div>
        </div>
      )}

      {/* Main 3-Column CMS Workspace Dashboard */}
      {repos.length > 0 && activeConfig && !loadingConfig && (
        <>
          {/* Backdrop overlay for mobile drawers */}
          {(draftsOpen || metaOpen) && (
            <div className="mobile-drawer-backdrop" onClick={() => { setDraftsOpen(false); setMetaOpen(false); }} />
          )}

          <div className="cms-workspace-grid-three-col">
          
          {/* Column 1: isolated Drafts Panel (Left) */}
          <aside className={`drafts-list-sidebar${draftsOpen ? ' drawer-open' : ''}`}>
            <div className="drafts-sidebar-header">
              <span className="drafts-header-title">Drafts Caching</span>
              <button className="btn-create-new-draft" onClick={() => handleCreateNewDraft()} title="Create New Draft" aria-label="Create new draft">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            </div>

            <div className="drafts-list-body">
              {loadingDrafts ? (
                <div className="drafts-empty">Loading drafts...</div>
              ) : drafts.length === 0 ? (
                <div className="drafts-empty">No drafts cached. Click "+" to create one.</div>
              ) : (
                drafts.map((draft) => (
                  <div
                    key={draft.id}
                    className={`draft-item-card ${docId === draft.id ? 'draft-item-card-active' : ''}`}
                    onClick={() => handleLoadDraftInWorkspace(draft.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleLoadDraftInWorkspace(draft.id);
                      }
                    }}
                  >
                    <div className="draft-item-top">
                      <span className="draft-item-title">{draft.title || 'Untitled Draft'}</span>
                      <button
                        className="btn-delete-draft"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDraft(draft.id, draft.title);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                        }}
                        title="Delete Draft"
                        aria-label="Delete draft"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                      </button>
                    </div>
                    <div className="draft-item-bottom">
                      <span className="draft-item-type-badge">{draft.type}</span>
                      <span className={`draft-item-status status-badge-${draft.status}`}>{draft.status}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Column 2: Visual BlockNote Canvas (Center) */}
          <section className="canvas-pane">
            <div className="canvas-header-input-wrapper relative">
              <input
                type="text"
                className="canvas-title-input"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Enter document title..."
              />
              
              {/* ✨ AI Headline Suggestions Trigger */}
              {docId && (
                <div className="headline-ai-action-container">
                  <button
                    className={`btn-generate-headline-ai ${generatingHeadlines ? 'loading' : ''}`}
                    onClick={handleGenerateHeadlines}
                    title="Brainstorm titles with Workers GenAI"
                    aria-label="Brainstorm titles with Workers GenAI"
                  >
                    {generatingHeadlines ? (
                      <svg className="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                    ) : (
                      <>✨ <span className="btn-text-desktop">AI Headline</span></>
                    )}
                  </button>

                  {/* Glassmorphic Suggestion Dropdown */}
                  {headlinesOpen && (
                    <div className="headline-suggestions-dropdown">
                      <div className="headline-suggestions-header">
                        <span className="headline-suggestions-header-title">✨ Headline Suggestions</span>
                        <button
                          className="btn-close-headlines"
                          onClick={() => setHeadlinesOpen(false)}
                          aria-label="Close suggestions"
                        >
                          ×
                        </button>
                      </div>
                      <div className="headline-suggestions-list">
                        {generatingHeadlines ? (
                          <div className="headline-ai-loader">
                            <svg className="spin-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)" />
                              <path d="M12 2a10 10 0 0 1 10 10" />
                            </svg>
                            <span>AI is brainstorming catchy headlines...</span>
                          </div>
                        ) : headlineSuggestions.length > 0 ? (
                          headlineSuggestions.map((headline, idx) => (
                            <button
                              key={idx}
                              className="headline-suggestion-item"
                              onClick={() => {
                                handleTitleChange(headline);
                                setHeadlinesOpen(false);
                              }}
                            >
                              <span className="headline-num-bullet">{idx + 1}</span>
                              <span className="headline-text-content">{headline}</span>
                            </button>
                          ))
                        ) : (
                          <div className="headline-suggestions-empty">
                            No headlines generated. Try adding more content to the draft first.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="canvas-editor-body">
              {docId ? (
                (() => {
                  const [owner, name] = selectedRepo ? selectedRepo.split('/') : ['', ''];
                  return (
                    <BlockNoteEditor
                      key={docId} // Fresh mount BlockNote editor whenever switching draft scopes
                      initialContent={JSON.stringify(blocks)}
                      onChange={(newBlocks) => setBlocks(newBlocks)}
                      repoOwner={owner}
                      repoName={name}
                      onPaywallTrigger={() => setIsUpgradeModalOpen(true)}
                    />
                  );
                })()
              ) : (
                <div className="text-slate-400 text-sm text-center py-10">Select a draft or create one.</div>
              )}
            </div>

          </section>

          {/* Column 3: Declarative Metadata Form Sidebar (Right) */}
          <aside className={`metadata-sidebar-pane${metaOpen ? ' drawer-open' : ''}`}>
            
            {/* dynamic Content Type selection (if multiple types connected) */}
            <div className="sidebar-section-title">Active Collection</div>
            <div className="sidebar-group">
              <label className="sidebar-label">Document Schema</label>
              <select
                className="sidebar-input pivot-select-sidebar"
                value={activeType}
                onChange={(e) => handleActiveTypeChange(e.target.value)}
              >
                {activeConfig.contentTypes.map((type: ContentType) => (
                  <option key={type.type} value={type.type}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="divider" />

            <div className="sidebar-section-title">{activeTypeLabel} Settings</div>
            
            <div className="sidebar-group">
              <label className="sidebar-label">Document Slug</label>
              <div className="slug-input-wrapper">
                <span className="slug-prefix">slug:</span>
                <input
                  type="text"
                  className="sidebar-input slug-input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  placeholder="e.g. zero-hosting-costs"
                />
              </div>
            </div>

            {/* Render dynamic inputs derived from GitOps config fields */}
            {activeFields.map((field: any) => {
              const fieldValue = metadata[field.name] || '';
              
              return (
                <div className="sidebar-group" key={field.name}>
                  <label className="sidebar-label">{field.label}</label>
                  
                  {field.type === 'text' && (
                    <input
                      type="text"
                      className="sidebar-input"
                      value={fieldValue}
                      onChange={(e) => handleMetadataChange(field.name, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                    />
                  )}

                  {field.type === 'slug' && (
                    <input
                      type="text"
                      className="sidebar-input"
                      value={fieldValue}
                      onChange={(e) => handleMetadataChange(field.name, e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                    />
                  )}

                  {field.type === 'textarea' && (
                    <textarea
                      className="sidebar-textarea"
                      value={fieldValue}
                      onChange={(e) => handleMetadataChange(field.name, e.target.value)}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                      rows={3}
                    />
                  )}

                  {field.type === 'description' && (
                    <div className="description-ai-wrapper">
                      <textarea
                        className="sidebar-textarea description-textarea"
                        value={fieldValue}
                        onChange={(e) => handleMetadataChange(field.name, e.target.value)}
                        placeholder={`Enter ${field.label.toLowerCase()}...`}
                        rows={3}
                      />
                      <div className={`description-char-counter ${
                        fieldValue.length >= 120 && fieldValue.length <= 160
                          ? 'perfect'
                          : fieldValue.length > 160
                          ? 'warning'
                          : fieldValue.length > 0
                          ? 'short'
                          : ''
                      }`}>
                        <span>
                          {fieldValue.length >= 120 && fieldValue.length <= 160 && '✨ Perfect SEO length'}
                          {fieldValue.length > 160 && '⚠️ Too long (will truncate in search)'}
                          {fieldValue.length > 0 && fieldValue.length < 120 && 'ℹ️ Too short'}
                        </span>
                        <span className="char-count">{fieldValue.length} / 160</span>
                      </div>
                      <button
                        type="button"
                        className="btn-ai-generate"
                        disabled={generatingFields[field.name]}
                        onClick={() => handleGenerateDescription(field.name)}
                      >
                        {generatingFields[field.name] ? (
                          <>
                            <span className="spinner-mini" /> Generating...
                          </>
                        ) : (
                          <>✨ Auto-Generate with GenAI</>
                        )}
                      </button>
                    </div>
                  )}

                  {field.type === 'number' && (
                    <input
                      type="number"
                      className="sidebar-input"
                      value={fieldValue}
                      onChange={(e) => handleMetadataChange(field.name, e.target.value)}
                      placeholder="0"
                    />
                  )}

                  {field.type === 'select' && (
                    <select
                      className="sidebar-input"
                      value={fieldValue}
                      onChange={(e) => handleMetadataChange(field.name, e.target.value)}
                    >
                      <option value="">Select option...</option>
                      {field.options?.map((opt: string) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'image' && (
                    <>
                      <input
                        type="text"
                        className="sidebar-input"
                        value={fieldValue}
                        onChange={(e) => handleMetadataChange(field.name, e.target.value)}
                        placeholder="https://images.unsplash.com/..."
                      />
                      
                      <div className="sidebar-upload-btn-row">
                        <input
                          type="file"
                          id={`file-upload-${field.name}`}
                          style={{ display: 'none' }}
                          accept="image/*"
                          disabled={uploadingFields.has(field.name)}
                          onChange={(e) => {
                            const selectedFile = e.target.files?.[0];
                            if (selectedFile) {
                              handleMetadataImageUpload(field.name, selectedFile);
                            }
                            e.currentTarget.value = '';
                          }}
                        />
                        <label
                          htmlFor={`file-upload-${field.name}`}
                          className={`sidebar-upload-btn ${uploadingFields.has(field.name) ? 'disabled' : ''}`}
                        >
                          {uploadingFields.has(field.name) ? (
                            <>
                              <svg className="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)" />
                                <path d="M12 2a10 10 0 0 1 10 10" />
                              </svg>
                              Uploading...
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                              </svg>
                              Upload Local Image
                            </>
                          )}
                        </label>
                        {fieldValue && (
                          <button
                            type="button"
                            className="sidebar-clear-btn"
                            onClick={() => handleMetadataChange(field.name, '')}
                            title="Clear image URL"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {fieldValue && (
                        <div className="sidebar-image-preview">
                          <img 
                            src={fieldValue} 
                            alt={field.label} 
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }} 
                          />
                        </div>
                      )}
                    </>
                  )}

                  {(field.type === 'list' || field.type === 'array' || field.type === 'tags') && (
                    <div className="tags-input-container">
                      <div className="tags-list">
                        {(Array.isArray(fieldValue)
                          ? fieldValue
                          : typeof fieldValue === 'string'
                          ? fieldValue.split(',').map((s: string) => s.trim()).filter(Boolean)
                          : []
                        ).map((tag: string, index: number) => (
                          <span key={index} className="tag-pill">
                            {tag}
                            <button
                              type="button"
                              className="tag-remove-btn"
                              aria-label={tag ? `Remove tag ${tag}` : "Remove tag"}
                              onClick={() => {
                                const currentArray = Array.isArray(fieldValue)
                                  ? fieldValue
                                  : typeof fieldValue === 'string'
                                  ? fieldValue.split(',').map((s: string) => s.trim()).filter(Boolean)
                                  : [];
                                const newArray = currentArray.filter((_: any, i: number) => i !== index);
                                handleMetadataChange(field.name, newArray);
                              }}
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                      <input
                        type="text"
                        className="sidebar-input tag-input-field"
                        placeholder="Add item and press Enter..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            const val = e.currentTarget.value.trim();
                            if (val) {
                              const currentArray = Array.isArray(fieldValue)
                                ? fieldValue
                                : typeof fieldValue === 'string'
                                ? fieldValue.split(',').map((s: string) => s.trim()).filter(Boolean)
                                : [];
                              if (!currentArray.includes(val)) {
                                const newArray = [...currentArray, val];
                                handleMetadataChange(field.name, newArray);
                              }
                              e.currentTarget.value = '';
                            }
                          }
                        }}
                        onBlur={(e) => {
                          const val = e.currentTarget.value.trim();
                          if (val) {
                            const currentArray = Array.isArray(fieldValue)
                              ? fieldValue
                              : typeof fieldValue === 'string'
                              ? fieldValue.split(',').map((s: string) => s.trim()).filter(Boolean)
                              : [];
                            if (!currentArray.includes(val)) {
                              const newArray = [...currentArray, val];
                              handleMetadataChange(field.name, newArray);
                            }
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn-ai-generate btn-list-ai-generate"
                        style={{ marginTop: '0.5rem', width: '100%' }}
                        disabled={generatingFields[field.name]}
                        onClick={() => handleGenerateCategories(field.name)}
                      >
                        {generatingFields[field.name] ? (
                          <>
                            <span className="spinner-mini" /> Generating...
                          </>
                        ) : (
                          <>
                            ✨ Auto-Suggest {field.name.toLowerCase().includes('category') ? 'Categories' : 'Tags'}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="divider" />

            {/* Git Publishing Metadata Panel */}
            <div className="publish-card">
              <div className="publish-card-header">Git Sync Target</div>
              <div className="publish-card-meta-list">
                <div className="publish-meta-item">
                  <span className="publish-meta-label">Repository</span>
                  <span className="publish-meta-value">{selectedRepo}</span>
                </div>
                <div className="publish-meta-item">
                  <span className="publish-meta-label">Branch</span>
                  <span className="publish-meta-value">{selectedBranch}</span>
                </div>
                <div className="publish-meta-item">
                  <span className="publish-meta-label">File Path</span>
                  <span className="publish-meta-value font-mono break-all" title={resolvedOutputPath}>
                    {resolvedOutputPath}
                  </span>
                </div>
              </div>
            </div>
          </aside>

          </div>
        </>
      )}
        </div>
      )}

      {/* Media Library Modal */}
      {isMediaLibraryOpen && (
        <div className="modal-overlay" onClick={() => setIsMediaLibraryOpen(false)}>
          <div
            className="media-library-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-library-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="media-library-header">
              <div id="media-library-title" className="media-library-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Media Library
                <span className="media-library-repo-badge">{selectedRepo}</span>
              </div>
              <button
                ref={mediaLibraryCloseRef}
                className="media-library-close"
                onClick={() => setIsMediaLibraryOpen(false)}
                aria-label="Close media library"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="media-library-body">
              {loadingMedia ? (
                <div className="media-library-loading">
                  <svg className="spin-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <span>Loading your media library...</span>
                </div>
              ) : mediaError ? (
                <div className="media-library-error">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>{mediaError}</span>
                  <button className="media-retry-btn" onClick={handleOpenMediaLibrary}>Retry</button>
                </div>
              ) : mediaImages.length === 0 ? (
                <div className="media-library-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.3}}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <p>No images uploaded yet.</p>
                  <p className="media-empty-hint">Upload images via the Image fields in the sidebar, or drag an image into the editor.</p>
                </div>
              ) : (
                <div className="media-image-grid">
                  {mediaImages.map((img) => (
                    <div key={img.key} className="media-image-card">
                      <div className="media-image-thumb-wrapper">
                        <img
                          src={img.url}
                          alt={img.name}
                          className="media-image-thumb"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const parent = (e.target as HTMLImageElement).parentElement;
                            if (parent) {
                              const errEl = document.createElement('div');
                              errEl.className = 'media-thumb-error';
                              errEl.textContent = '⚠️';
                              parent.appendChild(errEl);
                            }
                          }}
                        />
                      </div>
                      <div className="media-image-info">
                        <span className="media-image-name" title={img.name}>
                          {img.name.replace(/^[a-f0-9-]{36}-/, '')}
                        </span>
                        {img.size && (
                          <span className="media-image-size">
                            {img.size < 1024 * 1024
                              ? `${(img.size / 1024).toFixed(1)} KB`
                              : `${(img.size / (1024 * 1024)).toFixed(2)} MB`}
                          </span>
                        )}
                      </div>
                      <div className="media-image-actions">
                        <button
                          className={`media-btn-copy ${copiedKey === img.key ? 'copied' : ''}`}
                          onClick={() => handleCopyImageUrl(img.url, img.key)}
                          title="Copy image URL"
                        >
                          {copiedKey === img.key ? (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              Copied!
                            </>
                          ) : (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                              Copy URL
                            </>
                          )}
                        </button>
                        <button
                          className="media-btn-delete"
                          onClick={() => handleDeleteMediaImage(img.key)}
                          disabled={deletingKeys.has(img.key)}
                          title="Delete image"
                        >
                          {deletingKeys.has(img.key) ? (
                            <svg className="spin-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)" />
                              <path d="M12 2a10 10 0 0 1 10 10" />
                            </svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="media-library-footer">
              <span className="media-count">
                {!loadingMedia && !mediaError && `${mediaImages.length} image${mediaImages.length !== 1 ? 's' : ''} stored`}
              </span>
              <button className="btn-upgrade-cancel" onClick={() => setIsMediaLibraryOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Premium Glassmorphic Upgrade Modal Overlay */}
      {isUpgradeModalOpen && (
        <div className="modal-overlay" onClick={() => setIsUpgradeModalOpen(false)}>
          <div className="upgrade-modal" onClick={(e) => e.stopPropagation()}>
            <div className="upgrade-icon-wrapper">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
                <line x1="12" y1="2" x2="12" y2="22"/>
                <line x1="12" y1="12" x2="22" y2="8.5"/>
                <line x1="12" y1="12" x2="2" y2="8.5"/>
              </svg>
            </div>
            <h3 className="upgrade-title">Upgrade Workspace</h3>
            <p className="upgrade-description">
              Unleash the full potential of Pouta CMS. Unlock AI-powered writing assistants and zero-egress Cloudflare R2 media storage for: <br /><strong style={{color: '#ffffff'}}>{selectedRepo}</strong>
            </p>
            <div className="upgrade-features-list">
              <div className="upgrade-feature-item">
                <svg className="upgrade-feature-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>🚀 Unlimited Cloudflare R2 image storage</span>
              </div>
              <div className="upgrade-feature-item">
                <svg className="upgrade-feature-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>🪄 AI Copyediting, Summarizing & Translating</span>
              </div>
              <div className="upgrade-feature-item">
                <svg className="upgrade-feature-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>🏷️ Automatic accessibility alt-text generation</span>
              </div>
            </div>
            <div className="upgrade-actions">
              <a href={stripeCheckoutUrl} target="_blank" rel="noopener noreferrer" className="btn-upgrade-now">
                Upgrade Workspace Now
              </a>
              <button className="btn-upgrade-cancel" onClick={() => setIsUpgradeModalOpen(false)}>
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styled JSX for Premium UI Aesthetics */}
      <style>{`
        /* Subscription Plan Status Pill */
        .billing-status-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          margin-left: 8px;
        }

        .billing-status-pill.active {
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #10b981;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
        }

        .billing-status-pill.free {
          background: rgba(245, 158, 11, 0.08);
          border: 1px solid rgba(245, 158, 11, 0.2);
          color: #f59e0b;
        }

        .billing-portal-trigger {
          background: none;
          border: none;
          color: inherit;
          font: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 0;
          outline: none;
        }

        .billing-portal-trigger:hover {
          color: #ffffff;
          text-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
        }

        .billing-upgrade-trigger {
          background: none;
          border: none;
          color: inherit;
          font: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 0;
          outline: none;
        }

        .billing-upgrade-trigger:hover {
          color: #ffffff;
          text-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
        }

        /* Glassmorphic Upgrade Modal Overlay */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(4, 5, 8, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          animation: fadeIn 0.3s ease-out;
        }

        .upgrade-modal {
          background: rgba(18, 22, 31, 0.75);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 40px;
          max-width: 480px;
          width: 90%;
          text-align: center;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 40px rgba(245, 158, 11, 0.08);
          position: relative;
          overflow: hidden;
          font-family: 'Outfit', sans-serif;
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .upgrade-modal::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(234, 88, 12, 0.08) 0%, transparent 60%);
          pointer-events: none;
        }

        .upgrade-icon-wrapper {
          width: 72px;
          height: 72px;
          background: linear-gradient(135deg, rgba(234, 88, 12, 0.15) 0%, rgba(245, 158, 11, 0.15) 100%);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 24px;
          color: #f59e0b;
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.2);
        }

        .upgrade-title {
          font-size: 26px;
          font-weight: 700;
          margin-bottom: 12px;
          color: #ffffff;
          letter-spacing: -0.02em;
        }

        .upgrade-description {
          font-size: 15px;
          color: #8b9bb4;
          line-height: 1.6;
          margin-bottom: 30px;
        }

        .upgrade-features-list {
          text-align: left;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 16px 20px;
          margin-bottom: 32px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .upgrade-feature-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13.5px;
          color: #f3f4f6;
        }

        .upgrade-feature-icon {
          color: #10b981;
          flex-shrink: 0;
        }

        .upgrade-actions {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .btn-upgrade-now {
          background: var(--accent-gradient);
          color: #ffffff;
          border: none;
          padding: 14px 28px;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: var(--accent-glow);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-decoration: none;
        }

        .btn-upgrade-now:hover {
          transform: translateY(-2px);
          filter: brightness(1.1);
        }

        .btn-upgrade-cancel {
          background: transparent;
          color: #8b9bb4;
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 12px 28px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-upgrade-cancel:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #ffffff;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        /* Core Dark Styling and Typography */
        :root {
          --bg-dark: #0a0c10;
          --bg-card: rgba(18, 22, 31, 0.7);
          --border-color: rgba(255, 255, 255, 0.08);
          --text-muted: #8b9bb4;
          --text-light: #f3f4f6;
          --accent-orange: #ea580c;
          --accent-amber: #f59e0b;
          --accent-gradient: linear-gradient(135deg, #ea580c 0%, #f59e0b 100%);
          --accent-glow: 0 0 15px rgba(245, 158, 11, 0.4);
        }

        .cms-layout {
          background-color: var(--bg-dark);
          color: var(--text-light);
          height: 100vh;
          max-height: 100vh;
          overflow: clip;
          font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          flex-direction: column;
        }

        /* --------------------------------------------------
           Sign In / OAuth Landing Page
           -------------------------------------------------- */
        .login-screen {
          background-color: var(--bg-dark);
          color: var(--text-light);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Outfit', 'Inter', sans-serif;
          padding: 2rem;
        }

        .login-card {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          backdrop-filter: blur(12px);
          width: 100%;
          max-width: 480px;
          border-radius: 16px;
          padding: 3rem 2.5rem;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .brand-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          width: 100%;
          margin-bottom: 1.5rem;
        }

        .login-logo-img {
          height: 4.5rem;
          width: auto;
          display: block;
          margin: 0 auto 1rem;
          filter: drop-shadow(0 0 12px rgba(245, 158, 11, 0.3));
        }

        .login-brand-title {
          font-size: 2.2rem;
          font-weight: 800;
          letter-spacing: -0.04em;
          color: white;
          margin-bottom: 0.5rem;
          text-align: center;
        }

        .login-intro {
          font-size: 0.875rem;
          line-height: 1.6;
          color: var(--text-muted);
          text-align: center;
          margin: 1.5rem 0 2.5rem;
        }

        .btn-login-github {
          width: 100%;
          background: var(--accent-gradient);
          color: white;
          border: none;
          padding: 0.9rem;
          border-radius: 8px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          box-shadow: var(--accent-glow);
          text-decoration: none;
        }

        .btn-login-github:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        /* --------------------------------------------------
           Header Layout & Profile Indicators
           -------------------------------------------------- */
        .cms-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 2rem;
          background: rgba(10, 12, 16, 0.8);
          border-bottom: 1px solid var(--border-color);
          backdrop-filter: blur(12px);
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .logo-img {
          height: 2.1rem;
          width: auto;
          display: block;
        }

        .logo-text {
          font-family: 'Inter', 'Outfit', sans-serif;
          font-weight: 800;
          font-size: 1.35rem;
          color: white;
          letter-spacing: -0.04em;
          text-transform: lowercase;
          display: flex;
          align-items: center;
        }

        .logo-badge {
          background: rgba(245, 158, 11, 0.12);
          color: #fbbf24;
          font-size: 0.75rem;
          padding: 0.2rem 0.6rem;
          border-radius: 12px;
          border: 1px solid rgba(245, 158, 11, 0.25);
          font-weight: 500;
        }

        /* Global Repository Site Selector */
        .workspace-site-selector-wrapper {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(255, 255, 255, 0.04);
          padding: 0.4rem 0.75rem;
          border-radius: 8px;
          border: 1px solid var(--border-color);
        }

        .site-select-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .site-select {
          background: transparent;
          border: none;
          color: white;
          font-size: 0.85rem;
          font-weight: 700;
          outline: none;
          cursor: pointer;
          min-width: 0;
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .btn-add-repo {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          padding: 0.25rem 0.55rem;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-muted);
          font-size: 0.72rem;
          font-weight: 600;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          margin-left: 0.25rem;
        }
        .btn-add-repo:hover {
          background: rgba(255, 200, 0, 0.1);
          border-color: rgba(255, 200, 0, 0.35);
          color: #fbbf24;
        }
        .btn-add-repo svg {
          flex-shrink: 0;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 1.25rem;
        }

        /* Autosave indicators */
        .status-pill-container {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          width: 145px;
          flex-shrink: 0;
        }

        .status-pill {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(255, 255, 255, 0.04);
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          border: 1px solid var(--border-color);
          font-size: 0.8rem;
          font-weight: 500;
          transition: all 0.3s ease;
          white-space: nowrap;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #9ca3af;
        }

        .status-saved { background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.2); color: #34d399; }
        .status-saved .status-dot { background: #10b981; box-shadow: 0 0 8px #10b981; }

        .status-saving { background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.2); color: #fbbf24; }
        .status-saving .status-dot {
          background: #f59e0b;
          animation: pulse 1s infinite alternate;
        }

        .status-unsaved-changes { background: rgba(245, 158, 11, 0.05); border-color: rgba(245, 158, 11, 0.15); color: #fbbf24; }
        .status-unsaved-changes .status-dot { background: #ea580c; }

        .status-error { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); color: #f87171; }
        .status-error .status-dot { background: #ef4444; box-shadow: 0 0 8px #ef4444; }

        /* User Profile Badge */
        .user-profile-badge {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          background: rgba(255, 255, 255, 0.05);
          font-size: 0.8rem;
          padding: 0.3rem 0.5rem 0.3rem 0.3rem;
          border-radius: 20px;
          border: 1px solid var(--border-color);
          font-weight: 600;
        }

        .user-avatar {
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .user-name {
          color: white;
          max-width: 100px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .btn-logout {
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.2rem;
          border-radius: 50%;
          transition: all 0.2s ease;
        }

        .btn-logout:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
        }

        /* --------------------------------------------------
           Empty installations / config error screens
           -------------------------------------------------- */
        .no-installations-container, .config-missing-container, .config-error-container, .loading-config-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(180deg, #0d0f14 0%, #06070a 100%);
          padding: 2rem;
        }

        .no-installations-card, .config-missing-card {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          backdrop-filter: blur(8px);
          border-radius: 12px;
          padding: 3rem;
          max-width: 520px;
          width: 100%;
          text-align: center;
        }

        .no-inst-icon, .config-err-icon {
          font-size: 3rem;
          margin-bottom: 1.5rem;
          filter: drop-shadow(0 0 10px rgba(245, 158, 11, 0.3));
        }

        .no-installations-card h2, .config-missing-card h2 {
          font-size: 1.5rem;
          font-weight: 800;
          color: white;
          margin-bottom: 1rem;
        }

        .no-installations-card p, .config-missing-card p {
          font-size: 0.875rem;
          line-height: 1.6;
          color: var(--text-muted);
          margin-bottom: 2rem;
        }

        .btn-install-app {
          display: block;
          background: var(--accent-gradient);
          color: white;
          text-decoration: none;
          padding: 0.85rem;
          border-radius: 6px;
          font-weight: 700;
          font-size: 0.9rem;
          box-shadow: var(--accent-glow);
          margin-bottom: 1rem;
          transition: all 0.3s ease;
        }

        .btn-install-app:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        .btn-refresh-repos {
          width: 100%;
          background: rgba(255, 255, 255, 0.05);
          color: white;
          border: 1px solid var(--border-color);
          padding: 0.85rem;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .btn-refresh-repos:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .code-block-helper {
          background: #090b10;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          text-align: left;
          margin-bottom: 2rem;
          overflow: hidden;
        }

        .code-block-header {
          background: rgba(255, 255, 255, 0.03);
          border-bottom: 1px solid var(--border-color);
          padding: 0.5rem 1rem;
          font-size: 0.75rem;
          font-family: monospace;
          color: var(--text-muted);
          font-weight: 600;
        }

        .code-block-helper pre {
          padding: 1rem;
          font-size: 0.75rem;
          font-family: monospace;
          color: #34d399;
          margin: 0;
          overflow-x: auto;
        }

        /* --------------------------------------------------
           3-Column CMS Workspace Layout
           -------------------------------------------------- */
        .cms-workspace-grid-three-col {
          display: grid;
          grid-template-columns: 260px 1fr 340px;
          flex: 1;
          min-height: 0;
          overflow: clip;
        }

        /* Column 1: isolated Drafts Panel */
        .drafts-list-sidebar {
          background: rgba(13, 16, 23, 0.7);
          border-right: 1px solid var(--border-color);
          backdrop-filter: blur(12px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .drafts-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.25rem 1rem;
          border-bottom: 1px solid var(--border-color);
        }

        .drafts-header-title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #94a3b8;
        }

        .btn-create-new-draft {
          background: var(--accent-gradient);
          color: white;
          border: none;
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: var(--accent-glow);
        }

        .btn-create-new-draft:hover {
          filter: brightness(1.1);
          transform: scale(1.05);
        }

        .drafts-list-body {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .drafts-empty {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-align: center;
          padding: 2rem 1rem;
          line-height: 1.4;
        }

        .draft-item-card {
          box-sizing: border-box;
          width: 100%;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid transparent;
          border-radius: 6px;
          padding: 0.85rem;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .draft-item-card:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.05);
        }

        .draft-item-card:focus-visible {
          outline: 2px solid var(--accent-amber);
          outline-offset: -2px;
          background: rgba(255, 255, 255, 0.05);
        }

        .draft-item-card-active {
          background: rgba(245, 158, 11, 0.06) !important;
          border-color: rgba(245, 158, 11, 0.25) !important;
        }

        .btn-delete-draft {
          background: none;
          border: none;
          color: var(--text-muted);
          padding: 0.25rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          border-radius: 4px;
          opacity: 0;
          transition: all 0.2s ease;
        }

        .draft-item-card:hover .btn-delete-draft {
          opacity: 1;
        }

        .btn-delete-draft:hover {
          color: #ef4444 !important;
          background: rgba(239, 68, 68, 0.15) !important;
        }

        @media (max-width: 1279px) {
          .btn-delete-draft {
            opacity: 1;
          }
        }

        .draft-item-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          min-width: 0;
        }

        .draft-item-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: white;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: block;
          flex: 1;
          min-width: 0;
        }

        .draft-item-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .draft-item-type-badge {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          color: var(--text-muted);
          font-size: 0.65rem;
          font-weight: 600;
          padding: 0.1rem 0.4rem;
          border-radius: 4px;
          text-transform: capitalize;
        }

        .draft-item-status {
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .status-badge-draft { color: #fbbf24; }
        .status-badge-published { color: #34d399; }

        /* Column 2: Center Editor Pane */
        .canvas-pane {
          padding: 3rem 4rem 10rem 4rem;
          overflow-y: auto;
          background: linear-gradient(180deg, #0d0f14 0%, #06070a 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          min-height: 0;
        }

        /* Custom Premium Scrollbar Styling */
        .canvas-pane::-webkit-scrollbar,
        .drafts-list-body::-webkit-scrollbar,
        .metadata-sidebar-pane::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .canvas-pane::-webkit-scrollbar-track,
        .drafts-list-body::-webkit-scrollbar-track,
        .metadata-sidebar-pane::-webkit-scrollbar-track {
          background: transparent;
        }

        .canvas-pane::-webkit-scrollbar-thumb,
        .drafts-list-body::-webkit-scrollbar-thumb,
        .metadata-sidebar-pane::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 99px;
          border: 2px solid transparent;
          background-clip: padding-box;
          transition: background 0.2s ease;
        }

        .canvas-pane::-webkit-scrollbar-thumb:hover,
        .drafts-list-body::-webkit-scrollbar-thumb:hover,
        .metadata-sidebar-pane::-webkit-scrollbar-thumb:hover {
          background: var(--accent-gradient);
          border: 2px solid transparent;
          background-clip: padding-box;
        }

        .canvas-header-input-wrapper {
          width: 100%;
          max-width: 800px;
          margin-bottom: 2rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          padding-bottom: 0.5rem;
        }

        .canvas-title-input {
          flex-grow: 1;
          background: transparent;
          border: none;
          color: white;
          font-size: 2.5rem;
          font-weight: 800;
          letter-spacing: -0.03em;
          outline: none;
          padding: 0.5rem 0;
          transition: border-color 0.3s ease;
        }

        /* ✨ AI Headline Action Trigger Styles */
        .headline-ai-action-container {
          position: relative;
        }

        .btn-generate-headline-ai {
          display: flex;
          align-items: center;
          gap: 6px;
          background: linear-gradient(135deg, rgba(121, 40, 202, 0.2) 0%, rgba(255, 0, 128, 0.2) 100%);
          border: 1px solid rgba(121, 40, 202, 0.5);
          color: #f1f5f9;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 6px 12px;
          border-radius: 9999px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 0 10px rgba(121, 40, 202, 0.1);
        }

        .btn-generate-headline-ai:hover:not(.loading) {
          border-color: rgba(255, 0, 128, 0.8);
          background: linear-gradient(135deg, rgba(121, 40, 202, 0.4) 0%, rgba(255, 0, 128, 0.4) 100%);
          box-shadow: 0 0 15px rgba(255, 0, 128, 0.4);
          transform: translateY(-1px);
        }

        .btn-generate-headline-ai.loading {
          cursor: not-allowed;
          opacity: 0.7;
        }

        @media (max-width: 768px) {
          .btn-text-desktop {
            display: none;
          }
        }

        /* Headline suggestions glass dropdown */
        .headline-suggestions-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          width: 380px;
          background: rgba(15, 17, 26, 0.95);
          border: 1px solid rgba(121, 40, 202, 0.3);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(16px);
          z-index: 99;
          margin-top: 8px;
          overflow: hidden;
          animation: fade-in-slide 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes fade-in-slide {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .headline-suggestions-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          background: rgba(121, 40, 202, 0.05);
        }

        .headline-suggestions-header-title {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #f1f5f9;
        }

        .btn-close-headlines {
          background: transparent;
          border: none;
          color: #64748b;
          font-size: 18px;
          cursor: pointer;
          line-height: 1;
          transition: color 0.2s ease;
        }

        .btn-close-headlines:hover {
          color: #ef4444;
        }

        .headline-suggestions-list {
          padding: 8px;
          max-height: 320px;
          overflow-y: auto;
        }

        .headline-suggestion-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
          color: #cbd5e1;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12.5px;
          font-weight: 500;
          line-height: 1.4;
          margin-bottom: 4px;
        }

        .headline-suggestion-item:last-child {
          margin-bottom: 0;
        }

        .headline-suggestion-item:hover {
          background: rgba(121, 40, 202, 0.15);
          color: #ffffff;
          padding-left: 16px;
        }

        .headline-num-bullet {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          background: rgba(255, 0, 128, 0.15);
          border: 1px solid rgba(255, 0, 128, 0.4);
          color: #ff0080;
          font-size: 10px;
          font-weight: 700;
          border-radius: 99px;
          flex-shrink: 0;
          margin-top: 1px;
        }

        .headline-suggestion-item:hover .headline-num-bullet {
          background: #ff0080;
          color: #ffffff;
        }

        .headline-text-content {
          flex-grow: 1;
        }

        .headline-suggestions-empty {
          color: #64748b;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          text-align: center;
          padding: 20px;
        }

        .headline-ai-loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 24px;
          color: #94a3b8;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          font-weight: 500;
        }

        .canvas-title-input:focus {
          border-image: var(--accent-gradient) 1;
        }

        .canvas-editor-body {
          width: 100%;
          max-width: 800px;
          background: rgba(18, 22, 31, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-radius: 12px;
          padding: 1.5rem 1.5rem 35vh 1.5rem;
          backdrop-filter: blur(8px);
        }

        /* Column 3: Right Config Sidebar Panel */
        .metadata-sidebar-pane {
          background: var(--bg-card);
          border-left: 1px solid var(--border-color);
          backdrop-filter: blur(12px);
          padding: 2rem 1.5rem;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .sidebar-section-title {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #fbbf24;
          margin-bottom: 0.5rem;
          background: var(--accent-gradient);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .sidebar-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .sidebar-label {
          font-size: 0.8rem;
          font-weight: 600;
          color: #94a3b8;
        }

        .sidebar-input, .sidebar-textarea, .pivot-select-sidebar {
          background: rgba(10, 12, 16, 0.6);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: white;
          padding: 0.6rem 0.8rem;
          font-size: 0.875rem;
          outline: none;
          transition: all 0.3s ease;
        }

        .sidebar-input:focus, .sidebar-textarea:focus, .pivot-select-sidebar:focus {
          border-color: var(--accent-orange);
          box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3);
          background: rgba(10, 12, 16, 0.8);
        }

        .tags-input-container {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }

        .tag-pill {
          display: inline-flex;
          align-items: center;
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 4px;
          padding: 0.2rem 0.5rem;
          font-size: 0.75rem;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .tag-pill:hover {
          background: rgba(245, 158, 11, 0.25);
          border-color: rgba(245, 158, 11, 0.5);
        }

        .tag-remove-btn {
          background: none;
          border: none;
          color: #f87171;
          margin-left: 0.3rem;
          cursor: pointer;
          font-size: 0.875rem;
          line-height: 1;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .tag-remove-btn:hover {
          color: #ef4444;
        }

        .pivot-select-sidebar {
          cursor: pointer;
        }

        .slug-input-wrapper {
          display: flex;
          align-items: center;
          background: rgba(10, 12, 16, 0.6);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          overflow: hidden;
          transition: border-color 0.3s ease;
        }

        .slug-input-wrapper:focus-within {
          border-color: var(--accent-orange);
        }

        .slug-prefix {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-muted);
          padding: 0.6rem 0.8rem;
          font-size: 0.85rem;
          font-weight: 500;
          border-right: 1px solid var(--border-color);
          user-select: none;
        }

        .slug-input {
          border: none;
          background: transparent;
          flex: 1;
          padding: 0.6rem 0.8rem;
        }

        .sidebar-image-preview {
          margin-top: 0.5rem;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid var(--border-color);
          aspect-ratio: 16/9;
          background: #0f172a;
        }

        .sidebar-image-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .sidebar-upload-btn-row {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.5rem;
          width: 100%;
        }

        .sidebar-upload-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
          background: rgba(255, 255, 255, 0.04);
          border: 1px dashed rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          padding: 0.5rem 0.8rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-light);
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: center;
        }

        .sidebar-upload-btn:hover:not(.disabled) {
          background: rgba(245, 158, 11, 0.06);
          border-color: rgba(245, 158, 11, 0.4);
          color: var(--accent-amber);
        }

        .sidebar-upload-btn.disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .sidebar-clear-btn {
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 6px;
          padding: 0.5rem 0.8rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: #f87171;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .sidebar-clear-btn:hover {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.4);
        }

        .spin-icon {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          100% {
            transform: rotate(360deg);
          }
        }

        .divider {
          height: 1px;
          background: var(--border-color);
          margin: 0.5rem 0;
        }

        /* Git Publishing Card */
        .publish-card {
          background: rgba(245, 158, 11, 0.06);
          border: 1px solid rgba(245, 158, 11, 0.15);
          border-radius: 10px;
          padding: 1.25rem;
          margin-top: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .publish-card-header {
          font-size: 0.95rem;
          font-weight: 700;
          color: #fde68a;
        }

        .publish-card-desc {
          font-size: 0.775rem;
          color: #94a3b8;
          line-height: 1.4;
          margin: 0;
        }

        .btn-publish {
          background: var(--accent-gradient);
          color: white;
          border: none;
          padding: 0.75rem;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          box-shadow: var(--accent-glow);
        }

        .btn-publish:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        .btn-publish:disabled {
          background: #4b5563;
          box-shadow: none;
          cursor: not-allowed;
          filter: none;
          transform: none;
        }

        .btn-publish-published {
          background: #10b981;
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
        }

        .btn-publish-error {
          background: #ef4444;
          box-shadow: 0 0 15px rgba(239, 68, 68, 0.4);
        }

        .publish-error-message {
          font-size: 0.75rem;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: #f87171;
          padding: 0.5rem 0.75rem;
          border-radius: 4px;
          word-break: break-word;
          line-height: 1.4;
        }

        /* Visual spin animations */
        .spinner {
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 0.8s linear infinite;
        }

        .spinner-large {
          width: 2.5rem;
          height: 2.5rem;
          border: 3px solid rgba(245, 158, 11, 0.1);
          border-radius: 50%;
          border-top-color: var(--accent-amber);
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @keyframes pulse {
          to { opacity: 0.4; }
        }

        /* BlockNote Styling Adjustments */
        .bn-editor {
          background: transparent !important;
          color: var(--text-light) !important;
        }

        /* --------------------------------------------------
           Mobile sidebar toggle buttons (hidden on desktop)
           -------------------------------------------------- */
        .btn-mobile-sidebar-toggle {
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-muted);
          width: 2rem;
          height: 2rem;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }
        .btn-mobile-sidebar-toggle:hover {
          background: rgba(255,255,255,0.1);
          color: white;
        }

        /* Backdrop overlay */
        .mobile-drawer-backdrop {
          display: none;
          position: fixed;
          inset: 0;
          z-index: 199;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(2px);
        }

        /* --------------------------------------------------
           Tablet: 768px – 1279px
           Drafts sidebar collapses; 2-col editor + meta
           -------------------------------------------------- */
        @media (max-width: 1279px) {
          .btn-mobile-sidebar-toggle { display: flex; }

          .cms-header {
            padding: 0.75rem 1.25rem;
            gap: 0.75rem;
          }

          /* Hide the text label of the workspace selector to save space */
          .site-select-label { display: none; }

          /* Hide status pill text, show only dot */
          .status-label { display: none; }
          .status-pill-container { width: auto; }
          .status-pill { padding: 0.4rem 0.55rem; }

          /* Hide full username, keep avatar */
          .user-name { display: none; }

          /* Hide logo badge */
          .logo-badge { display: none; }

          .cms-workspace-grid-three-col {
            grid-template-columns: 1fr 300px;
          }

          /* Drafts sidebar becomes a fixed left drawer */
          .drafts-list-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 280px;
            z-index: 200;
            transform: translateX(-100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 4px 0 24px rgba(0,0,0,0.5);
          }
          .drafts-list-sidebar.drawer-open {
            transform: translateX(0);
          }
          .mobile-drawer-backdrop { display: block; }

          .canvas-pane {
            padding: 2rem 2rem;
          }
        }

        .description-ai-wrapper {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .description-char-counter {
          display: flex;
          justify-content: space-between;
          font-size: 0.72rem;
          color: #94a3b8;
          padding: 0 0.1rem;
          margin-top: -0.2rem;
          margin-bottom: 0.1rem;
          transition: color 0.2s ease;
        }

        .description-char-counter.perfect {
          color: #34d399; /* emerald green */
        }

        .description-char-counter.warning {
          color: #fbbf24; /* amber yellow */
        }

        .description-char-counter.short {
          color: #94a3b8; /* neutral slate */
        }

        .char-count {
          font-weight: 500;
        }

        .btn-ai-generate {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
          color: white;
          border: none;
          border-radius: 6px;
          padding: 0.45rem 0.8rem;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(79, 70, 229, 0.25);
        }

        .btn-ai-generate:hover:not(:disabled) {
          background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
        }

        .btn-ai-generate:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          background: #4b5563;
          box-shadow: none;
        }

        .spinner-mini {
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin-mini 0.8s linear infinite;
        }

        @keyframes spin-mini {
          to { transform: rotate(360deg); }
        }

        /* --------------------------------------------------
           Mobile: < 768px
           Full single-column, both sidebars are drawers
           -------------------------------------------------- */
        @media (max-width: 767px) {
          /* Two-row header on mobile */
          .cms-header {
            flex-wrap: wrap;
            padding: 0.6rem 0.85rem;
            gap: 0.5rem;
          }

          /* Logo takes its natural width, actions push to the right */
          .header-logo {
            flex: 1;
          }

          /* Workspace selector goes full-width on its own row */
          .workspace-site-selector-wrapper {
            order: 3;
            flex: 0 0 100%;
            width: 100%;
            box-sizing: border-box;
          }

          /* Constrain the select so a long repo name can't overflow */
          .site-select {
            flex: 1;
            min-width: 0;
            max-width: calc(100vw - 140px);
          }

          /* Hide "Add Repo" text, keep only the + icon */
          .btn-add-repo {
            font-size: 0;
            padding: 0.25rem 0.4rem;
          }
          .btn-add-repo svg {
            width: 14px;
            height: 14px;
          }

          .cms-workspace-grid-three-col {
            grid-template-columns: 1fr;
          }

          /* Both sidebars become full fixed drawers */
          .drafts-list-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: min(280px, 85vw);
            z-index: 200;
            transform: translateX(-100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 4px 0 24px rgba(0,0,0,0.5);
          }
          .drafts-list-sidebar.drawer-open {
            transform: translateX(0);
          }

          .metadata-sidebar-pane {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: min(320px, 92vw);
            z-index: 200;
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: -4px 0 24px rgba(0,0,0,0.5);
          }
          .metadata-sidebar-pane.drawer-open {
            transform: translateX(0);
          }

          .canvas-pane {
            padding: 1.25rem 1rem;
          }

          .canvas-title-input {
            font-size: 1.6rem;
          }

          .canvas-header-input-wrapper,
          .canvas-editor-body {
            max-width: 100%;
          }
        }

        /* ─── Media Library Button ───────────────────────────────── */
        .btn-media-library {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 8px;
          color: #a5b4fc;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          font-family: 'Outfit', sans-serif;
        }
        .btn-media-library:hover {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.5);
          color: #c7d2fe;
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.2);
        }
        .btn-media-label {
          display: inline;
        }

        /* ─── Media Library Modal ─────────────────────────────────── */
        .media-library-modal {
          background: rgba(13, 17, 28, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          width: min(900px, 95vw);
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.08);
          animation: slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          font-family: 'Outfit', sans-serif;
          overflow: hidden;
        }

        .media-library-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }

        .media-library-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 15px;
          font-weight: 700;
          color: #e2e8f0;
          letter-spacing: -0.01em;
        }

        .media-library-repo-badge {
          font-size: 10px;
          font-weight: 600;
          padding: 3px 8px;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 9999px;
          color: #a5b4fc;
          letter-spacing: 0.02em;
        }

        .media-library-close {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          color: #94a3b8;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .media-library-close:hover {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.25);
          color: #f87171;
        }

        .media-library-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          min-height: 200px;
        }

        .media-library-loading,
        .media-library-error,
        .media-library-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 60px 20px;
          color: #64748b;
          text-align: center;
        }
        .media-library-error { color: #f87171; }
        .media-empty-hint {
          font-size: 12px;
          color: #475569;
          max-width: 320px;
          line-height: 1.6;
        }

        .media-retry-btn {
          padding: 6px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: 6px;
          color: #f87171;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .media-retry-btn:hover { background: rgba(239, 68, 68, 0.2); }

        /* Image Grid */
        .media-image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 14px;
        }

        .media-image-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          overflow: hidden;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
        }
        .media-image-card:hover {
          border-color: rgba(99, 102, 241, 0.3);
          box-shadow: 0 4px 20px rgba(99, 102, 241, 0.1);
          transform: translateY(-2px);
        }

        .media-image-thumb-wrapper {
          width: 100%;
          aspect-ratio: 4/3;
          background: rgba(255,255,255,0.03);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          position: relative;
        }

        .media-image-thumb {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s ease;
        }
        .media-image-card:hover .media-image-thumb {
          transform: scale(1.04);
        }

        .media-thumb-error {
          font-size: 24px;
          opacity: 0.4;
        }

        .media-image-info {
          padding: 8px 10px 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }

        .media-image-name {
          font-size: 11px;
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 500;
        }

        .media-image-size {
          font-size: 10px;
          color: #475569;
        }

        .media-image-actions {
          display: flex;
          gap: 6px;
          padding: 8px 10px 10px;
        }

        .media-btn-copy,
        .media-btn-delete {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: 'Outfit', sans-serif;
          white-space: nowrap;
        }

        .media-btn-copy {
          flex: 1;
          justify-content: center;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.2);
          color: #a5b4fc;
        }
        .media-btn-copy:hover {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.4);
        }
        .media-btn-copy.copied {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.3);
          color: #34d399;
        }

        .media-btn-delete {
          background: rgba(239, 68, 68, 0.07);
          border: 1px solid rgba(239, 68, 68, 0.15);
          color: #f87171;
          padding: 5px 9px;
        }
        .media-btn-delete:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.35);
        }
        .media-btn-delete:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .media-library-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 24px 18px;
          border-top: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }

        .media-count {
          font-size: 12px;
          color: #475569;
          font-weight: 500;
        }

        @media (max-width: 480px) {
          .btn-media-label { display: none; }
          .media-image-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
          .media-library-modal { max-height: 92vh; }
        }

        /* Prevent nested scrollbars & scroll trapping in BlockEditor so it grows naturally */
        .blocknote-editor-wrapper {
          height: auto !important;
        }
        .bn-container,
        .bn-editor,
        .bn-root,
        .ProseMirror,
        .mantine-ScrollArea-root,
        .mantine-ScrollArea-viewport,
        .mantine-ScrollArea-content {
          height: auto !important;
          min-height: 100% !important;
          overflow-y: visible !important;
          overflow: visible !important;
        }

        /* ─── Premium Sticky Header Publish Button ────────────────── */
        .btn-header-publish {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: var(--accent-gradient);
          border: none;
          border-radius: 8px;
          color: white;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 8px rgba(234, 88, 12, 0.25);
        }

        .btn-header-publish:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(234, 88, 12, 0.4);
        }

        .btn-header-publish:disabled {
          background: #1e293b;
          color: #64748b;
          border: 1px solid rgba(255, 255, 255, 0.05);
          cursor: not-allowed;
          box-shadow: none;
        }

        .btn-header-publish-publishing {
          background: #1e293b !important;
          color: #cbd5e1 !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          box-shadow: none !important;
          cursor: not-allowed;
        }

        .btn-header-publish-published {
          background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25) !important;
        }

        .btn-header-publish-error {
          background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%) !important;
          box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25) !important;
        }

        /* Glassmorphic Alert Popover for Publication Errors */
        .header-publish-error-popup {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 8px;
          width: 290px;
          background: rgba(15, 17, 26, 0.95);
          border: 1px solid rgba(239, 68, 68, 0.35);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(20px);
          overflow: hidden;
          z-index: 250;
          padding: 12px 14px;
          animation: fade-in-slide 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          text-align: left;
        }

        .header-publish-error-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11px;
          font-weight: 700;
          color: #f87171;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 6px;
        }

        .btn-close-error-popup {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 14px;
          cursor: pointer;
          line-height: 1;
        }
        
        .btn-close-error-popup:hover {
          color: white;
        }

        .header-publish-error-body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11.5px;
          color: #cbd5e1;
          line-height: 1.5;
        }

        /* Git Publishing Sidebar Meta list */
        .publish-card-meta-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 8px;
        }

        .publish-meta-item {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .publish-meta-label {
          font-family: 'Outfit', sans-serif;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: var(--text-muted);
        }

        .publish-meta-value {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 11.5px;
          color: white;
          font-weight: 500;
        }
      `}</style>
    </>
  );
}
