import {ClerkProvider,Show,SignIn,useAuth} from '@clerk/react';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {configureAuthenticatedFetch} from './authenticatedFetch';

const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
const BuildLitePrincipalContext=createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useBuildLitePrincipal(){return useContext(BuildLitePrincipalContext);}
// eslint-disable-next-line react-refresh/only-export-components
export function useBuildLitePermission(permission){
  const principal=useBuildLitePrincipal();
  return Array.isArray(principal?.permissions)&&principal.permissions.includes(permission);
}

function AuthenticatedShell({children}){
  const {getToken}=useAuth();
  const [ready,setReady]=useState(false),[principal,setPrincipal]=useState(null),[authorizationError,setAuthorizationError]=useState('');
  const principalRef=useRef(null),readinessRequestRef=useRef(null);
  principalRef.current=principal;
  useEffect(()=>{configureAuthenticatedFetch(getToken);setReady(true);},[getToken]);
  const loadPrincipal=useCallback(async()=>{const response=await fetch(`${API_BASE}/api/auth/me`);const body=await response.json().catch(()=>({}));if(!response.ok){if(response.status===409&&body.code==='TENANT_SELECTION_REQUIRED'){setPrincipal({selectionRequired:true,memberships:body.memberships||[]});return;}throw new Error(response.status===403?'Your BuildLite account has no active company membership.':'Your BuildLite session could not be established.');}setPrincipal(body);setAuthorizationError('');if(body.activeTenant?.clientId&&!localStorage.getItem('buildlite_active_client_id'))localStorage.setItem('buildlite_active_client_id',body.activeTenant.clientId);},[]);
  const refreshTenantReadiness=useCallback(()=>{
    const clientId=principalRef.current?.activeTenant?.clientId;
    if(!clientId)return Promise.reject(new Error('Active company is unavailable.'));
    if(readinessRequestRef.current?.clientId===clientId)return readinessRequestRef.current.promise;
    const promise=(async()=>{
      const response=await fetch(`${API_BASE}/api/auth/readiness`);const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message||'Company readiness could not be refreshed.');
      if(String(body.clientId)!==String(clientId)||String(principalRef.current?.activeTenant?.clientId)!==String(clientId))throw new Error('Active company changed while readiness was loading.');
      setPrincipal(current=>String(current?.activeTenant?.clientId)===String(clientId)?{...current,tenantReadiness:body.tenantReadiness}:current);
      return body.tenantReadiness;
    })().finally(()=>{if(readinessRequestRef.current?.promise===promise)readinessRequestRef.current=null;});
    readinessRequestRef.current={clientId,promise};return promise;
  },[]);
  useEffect(()=>{if(!ready)return;loadPrincipal().catch(error=>setAuthorizationError(error.message));},[loadPrincipal,ready]);
  useEffect(()=>{const show=event=>setAuthorizationError(event.detail?.status===403?'You do not have permission to perform that action.':'Your session has expired. Please sign in again.');globalThis.addEventListener('buildlite:authorization-error',show);return()=>globalThis.removeEventListener('buildlite:authorization-error',show);},[]);
  const switchTenant=(clientId)=>{localStorage.setItem('buildlite_active_client_id',clientId);window.location.assign('/');};
  const contextValue=useMemo(()=>principal?{...principal,switchTenant,refreshPrincipal:loadPrincipal,refreshTenantReadiness}:principal,[loadPrincipal,principal,refreshTenantReadiness]);
  if(!ready||(!principal&&!authorizationError))return <main className="auth-loading">Establishing secure BuildLite session…</main>;
  if(authorizationError&&!principal)return <main className="auth-configuration"><h1>BuildLite access unavailable</h1><p>{authorizationError}</p></main>;
  if(principal?.selectionRequired)return <main className="auth-configuration"><h1>Select company</h1>{principal.memberships.map(item=><button key={item.clientId} type="button" onClick={()=>switchTenant(item.clientId)}>{item.clientName} · {item.roleName}</button>)}</main>;
  return <BuildLitePrincipalContext.Provider value={contextValue}><div className="buildlite-auth-status" role="status">{`Signed in as ${principal.user.displayName} · ${principal.activeTenant.roleName}`}</div>{authorizationError&&<div className="buildlite-auth-error" role="alert">{authorizationError}</div>}{children}</BuildLitePrincipalContext.Provider>;
}

export default function BuildLiteAuthProvider({children}){
  const publishableKey=import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if(!publishableKey)return <main className="auth-configuration"><h1>BuildLite authentication is not configured</h1><p>Set VITE_CLERK_PUBLISHABLE_KEY for this environment.</p></main>;
  const returnUrl=typeof window==='undefined'?'/':`${window.location.pathname}${window.location.search}`;
  return <ClerkProvider publishableKey={publishableKey} signInFallbackRedirectUrl={returnUrl}>
    <Show when="signed-out"><main className="auth-sign-in"><SignIn withSignUp={false}/></main></Show>
    <Show when="signed-in"><AuthenticatedShell>{children}</AuthenticatedShell></Show>
  </ClerkProvider>;
}
