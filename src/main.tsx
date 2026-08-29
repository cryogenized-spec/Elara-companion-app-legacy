import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppearanceQuickPanel } from './components/AppearanceQuickPanel';
import { ModelTuningQuickPanel } from './components/ModelTuningQuickPanel';
import { AgentBehaviorPolicyPanel } from './components/AgentBehaviorPolicyPanel';
import { ElaraSurfaces } from './components/ElaraSurfaces';
import { OocConversationPanel } from './components/OocConversationPanel';
import { BackgroundNotificationsControl } from './components/BackgroundNotificationsControl';
import { ComposerDraftRecovery } from './components/ComposerDraftRecovery';
import { ComposerMarkdownAnchor } from './components/ComposerMarkdownAnchor';
import { ComposerOutboxRecovery } from './components/ComposerOutboxRecovery';
import { RoutingDiagnosticsPanel } from './components/RoutingDiagnosticsPanel';
import { ComposerModelSelectorBridge } from './components/ComposerModelSelectorBridge';
import { GeminiMinimalProbePanel } from './components/GeminiMinimalProbePanel';
import { installBackgroundSafeAbortBoundary } from './lib/backgroundSafeRuntime';
import { installMobileViewportSync } from './lib/mobileViewport';
import './index.css';
import './mobile-chat.css';
import './chat-pass1-declutter.css';
import './mobile-sidebar-layer.css';

installBackgroundSafeAbortBoundary();
installMobileViewportSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <AppearanceQuickPanel />
    <ModelTuningQuickPanel />
    <AgentBehaviorPolicyPanel />
    <ElaraSurfaces />
    <OocConversationPanel />
    <BackgroundNotificationsControl />
    <ComposerDraftRecovery />
    <ComposerMarkdownAnchor />
    <ComposerOutboxRecovery />
    <RoutingDiagnosticsPanel />
    <ComposerModelSelectorBridge />
    <GeminiMinimalProbePanel />
  </StrictMode>,
);