import {ClerkProvider,Show,SignIn,SignUp,useAuth,useClerk} from '@clerk/react';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {configureAuthenticatedFetch} from './authenticatedFetch';
import {recordAuthTiming,timingStart} from './authTiming';

const API_BASE=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/+$/,'');
const BuildLitePrincipalContext=createContext(null);
const inviteToken=()=>new URL(window.location.href).searchParams.get('membershipInvite');
const isAuthPath=(pathname,basePath)=>pathname===basePath||pathname.startsWith(`${basePath}/`);
const authUrl=path=>{const token=inviteToken();return token?`${path}?membershipInvite=${encodeURIComponent(token)}`:path;};
const applicationReturnUrl=()=>authUrl('/');
const authNavigationUrl=destination=>{
 const currentToken=inviteToken(),url=new URL(destination,window.location.origin);
 if(url.origin!==window.location.origin)return currentToken?`/sign-in?membershipInvite=${encodeURIComponent(currentToken)}`:'/sign-in';
 if(!currentToken)return `${url.pathname}${url.search}${url.hash}`;
 return `${url.pathname}?membershipInvite=${encodeURIComponent(currentToken)}${url.hash}`;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useBuildLitePrincipal(){return useContext(BuildLitePrincipalContext);}
// eslint-disable-next-line react-refresh/only-export-components
export function useBuildLitePermission(permission){
  const principal=useBuildLitePrincipal();
  return Array.isArray(principal?.permissions)&&principal.permissions.includes(permission);
}

function AuthenticatedShell({children}){
 const {getToken}=useAuth();
 const {signOut}=useClerk();
  const [ready,setReady]=useState(false),[principal,setPrincipal]=useState(null),[authorizationError,setAuthorizationError]=useState('');
  const [readinessFreshness,setReadinessFreshness]=useState({state:'loading',clientId:null,error:'',hasAuthoritativeData:false});
  const principalRef=useRef(null),readinessRequestRef=useRef(null);
  principalRef.current=principal;
  useEffect(()=>{recordAuthTiming('clerk_signed_in_boundary');configureAuthenticatedFetch(getToken);setReady(true);recordAuthTiming('authenticated_fetch_bridge_ready');},[getToken]);
  const loadPrincipal=useCallback(async()=>{const started=timingStart();const response=await fetch(`${API_BASE}/api/auth/me`);recordAuthTiming('auth_me_request',started);const body=await response.json().catch(()=>({}));if(!response.ok){if(response.status===409&&body.code==='TENANT_SELECTION_REQUIRED'){setPrincipal({selectionRequired:true,memberships:body.memberships||[]});setReadinessFreshness({state:'stale',clientId:null,error:'',hasAuthoritativeData:false});return;}throw new Error(response.status===403?'Your BuildLite account has no active company membership.':'Your BuildLite session could not be established.');}setPrincipal(body);const clientId=body.activeTenant?.clientId||null,hasAuthoritativeData=Boolean(clientId&&body.tenantReadiness);setReadinessFreshness({state:hasAuthoritativeData?'fresh':'stale',clientId,error:'',hasAuthoritativeData});setAuthorizationError('');if(clientId&&!localStorage.getItem('buildlite_active_client_id'))localStorage.setItem('buildlite_active_client_id',clientId);recordAuthTiming('principal_established');return body;},[]);
  const markTenantReadinessStale=useCallback(()=>{const clientId=principalRef.current?.activeTenant?.clientId||null;setReadinessFreshness({state:'stale',clientId,error:'',hasAuthoritativeData:false});},[]);
  const refreshTenantReadiness=useCallback(()=>{
    const clientId=principalRef.current?.activeTenant?.clientId;
    if(!clientId)return Promise.reject(new Error('Active company is unavailable.'));
    if(readinessRequestRef.current?.clientId===clientId)return readinessRequestRef.current.promise;
    const promise=(async()=>{
      const started=timingStart();setReadinessFreshness(current=>({state:'refreshing',clientId,error:'',hasAuthoritativeData:String(current.clientId)===String(clientId)&&current.hasAuthoritativeData===true}));
      const response=await fetch(`${API_BASE}/api/auth/readiness`);const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.message||'Company readiness could not be refreshed.');
      if(String(body.clientId)!==String(clientId)||String(principalRef.current?.activeTenant?.clientId)!==String(clientId))throw new Error('Active company changed while readiness was loading.');
      setPrincipal(current=>String(current?.activeTenant?.clientId)===String(clientId)?{...current,tenantReadiness:body.tenantReadiness}:current);
      setReadinessFreshness({state:'fresh',clientId,error:'',hasAuthoritativeData:true});recordAuthTiming('readiness_refresh',started);
      return body.tenantReadiness;
    })().catch(error=>{if(String(principalRef.current?.activeTenant?.clientId)===String(clientId))setReadinessFreshness(current=>({state:'error',clientId,error:error.message||'Company readiness could not be refreshed.',hasAuthoritativeData:String(current.clientId)===String(clientId)&&current.hasAuthoritativeData===true}));throw error;}).finally(()=>{if(readinessRequestRef.current?.promise===promise)readinessRequestRef.current=null;});
    readinessRequestRef.current={clientId,promise};return promise;
  },[]);
  useEffect(()=>{if(!ready)return;const establish=async()=>{const url=new URL(window.location.href),token=url.searchParams.get('membershipInvite');if(token){const response=await fetch(`${API_BASE}/api/membership-invitations/accept`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||'Company invitation could not be accepted.');localStorage.setItem('buildlite_active_client_id',body.clientId);url.searchParams.delete('membershipInvite');if(isAuthPath(url.pathname,'/sign-in')||isAuthPath(url.pathname,'/sign-up'))url.pathname='/';window.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);}await loadPrincipal();};establish().catch(error=>setAuthorizationError(error.message));},[loadPrincipal,ready]);
  useEffect(()=>{const show=event=>setAuthorizationError(event.detail?.status===403?'You do not have permission to perform that action.':'Your session has expired. Please sign in again.');globalThis.addEventListener('buildlite:authorization-error',show);return()=>globalThis.removeEventListener('buildlite:authorization-error',show);},[]);
  const switchTenant=(clientId)=>{localStorage.setItem('buildlite_active_client_id',clientId);window.location.assign('/');};
  const contextValue=useMemo(()=>principal?{...principal,switchTenant,refreshPrincipal:loadPrincipal,refreshTenantReadiness,markTenantReadinessStale,readinessFreshness}:principal,[loadPrincipal,markTenantReadinessStale,principal,readinessFreshness,refreshTenantReadiness]);
  if(!ready||(!principal&&!authorizationError))return <main className="auth-loading">Establishing secure BuildLite session…</main>;
  if(authorizationError&&!principal){const wrongAccount=authorizationError==='This invitation belongs to a different authenticated email.';return <main className="auth-configuration"><h1>{wrongAccount?'This invitation is for a different account.':'BuildLite access unavailable'}</h1><p>{wrongAccount?'You are currently signed in with another BuildLite account. Sign out and continue with the invited account.':authorizationError}</p>{wrongAccount?<button type="button" onClick={()=>signOut({redirectUrl:authUrl('/sign-in')})}>Sign out &amp; continue</button>:null}</main>;}
  if(principal?.selectionRequired)return <main className="auth-configuration"><h1>Select company</h1>{principal.memberships.map(item=><button key={item.clientId} type="button" onClick={()=>switchTenant(item.clientId)}>{item.clientName} · {item.roleName}</button>)}</main>;
  const tenantRole=principal.activeTenant?.roleName;
  return <BuildLitePrincipalContext.Provider value={contextValue}><div className="buildlite-auth-status"><span role="status">{tenantRole?`Signed in as ${principal.user.displayName} · ${tenantRole}`:`Signed in as ${principal.user.displayName}`}</span><button type="button" className="po-list-btn-secondary" onClick={()=>signOut({redirectUrl:'/sign-in'})}>Sign out</button></div>{authorizationError&&<div className="buildlite-auth-error" role="alert">{authorizationError}</div>}{children}</BuildLitePrincipalContext.Provider>;
}

function SignedOutAuthentication(){
 const path=window.location.pathname,returnUrl=applicationReturnUrl(),signInUrl=authUrl('/sign-in'),signUpUrl=authUrl('/sign-up');
 if(isAuthPath(path,'/sign-up'))return <main className="auth-sign-in"><SignUp routing="path" path="/sign-up" signInUrl={signInUrl} fallbackRedirectUrl={returnUrl}/></main>;
 if(isAuthPath(path,'/sign-in'))return <main className="auth-sign-in"><SignIn routing="path" path="/sign-in" signUpUrl={signUpUrl} fallbackRedirectUrl={returnUrl}/></main>;
 return <main className="auth-sign-in"><SignIn routing="virtual" signUpUrl={signUpUrl} fallbackRedirectUrl={returnUrl}/></main>;
}

export default function BuildLiteAuthProvider({children}){
  const [,setAuthNavigationVersion]=useState(0);
  const publishableKey=import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if(!publishableKey)return <main className="auth-configuration"><h1>BuildLite authentication is not configured</h1><p>Set VITE_CLERK_PUBLISHABLE_KEY for this environment.</p></main>;
  const returnUrl=typeof window==='undefined'?'/':applicationReturnUrl();
  const navigateAuth=(method,destination)=>{window.history[method]({},'',authNavigationUrl(destination));setAuthNavigationVersion(version=>version+1);};
  return <ClerkProvider publishableKey={publishableKey} signInUrl={authUrl('/sign-in')} signUpUrl={authUrl('/sign-up')} signInFallbackRedirectUrl={returnUrl} signUpFallbackRedirectUrl={returnUrl} routerPush={destination=>navigateAuth('pushState',destination)} routerReplace={destination=>navigateAuth('replaceState',destination)}>
    <Show when="signed-out"><SignedOutAuthentication/></Show>
    <Show when="signed-in"><AuthenticatedShell>{children}</AuthenticatedShell></Show>
  </ClerkProvider>;
}
