import { useEffect, useState } from 'react';
import { type Address } from 'viem';
import { ImageUpload, TokenLogo } from '../components/Media';
import { ipfsUrl, mediaRequest, type Profile as ProfileData } from '../lib/ipfs';
import { useQuery, invalidate } from '../lib/query';
import { shortAddress } from '../lib/format';
import { useWallet, openConnect } from '../lib/wallet';

export default function Profile({ address: target }: { address?: Address }) {
  const { address, provider } = useWallet();
  const owner = target || address;
  const own = owner?.toLowerCase() === address?.toLowerCase();
  const profile = useQuery(owner ? `profile:${owner.toLowerCase()}` : null, async () => {
    const response = await fetch(`/api/media/profiles/${owner}`);
    if (!response.ok) throw new Error('Profile service unavailable');
    return (await response.json()) as ProfileData | null;
  });
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    setName(profile.data?.name || '');
    setBio(profile.data?.bio || '');
    setAvatar(profile.data?.avatar || '');
    setWebsite(profile.data?.website || '');
  }, [profile.data?.uri, owner]);
  if (!owner)
    return (
      <div className="empty">
        <h1>Your profile</h1>
        <button className="btn btn-primary" onClick={openConnect}>
          Connect wallet
        </button>
      </div>
    );
  return (
    <div className="center-col">
      <h1>{own ? 'Your profile' : 'Trader profile'}</h1>
      <section className="card card-pad stack">
        <div className="row">
          <TokenLogo uri={profile.data?.avatar} seed={owner} size={64} />
          <div>
            <h2>{profile.data?.name || shortAddress(owner)}</h2>
            <p className="muted">{shortAddress(owner)}</p>
          </div>
        </div>
        {profile.loading && <p className="muted">Loading profile…</p>}
        {profile.error && (
          <p role="alert" className="down">
            {profile.error}
          </p>
        )}
        {own ? (
          <>
            <ImageUpload
              value={avatar}
              onChange={setAvatar}
              label="Profile photo"
              onBusy={setUploading}
            />
            <div className="field">
              <label htmlFor="profile-name">Display name</label>
              <input
                id="profile-name"
                className="input"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="profile-bio">Bio</label>
              <textarea
                id="profile-bio"
                className="input"
                maxLength={280}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="profile-website">Website (HTTPS)</label>
              <input
                id="profile-website"
                className="input"
                type="url"
                maxLength={200}
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <p className="faint">Your profile is public.</p>
            <button
              className="btn btn-primary"
              disabled={busy || uploading || profile.loading}
              onClick={async () => {
                if (!address || !provider) return;
                setBusy(true);
                setStatus('');
                try {
                  await mediaRequest('profile', { name, bio, avatar, website }, address, provider);
                  invalidate('profile:');
                  setStatus('Profile published to IPFS');
                } catch (e) {
                  setStatus(e instanceof Error ? e.message : 'Publish failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Signing / publishing…' : 'Publish profile'}
            </button>
            {status && <p role="status">{status}</p>}
          </>
        ) : (
          <>
            <p>{profile.data?.bio || 'No public bio yet.'}</p>
            {profile.data?.website?.startsWith('https://') && (
              <a className="link" href={profile.data.website} target="_blank" rel="noreferrer">
                Website
              </a>
            )}
          </>
        )}
        {profile.data?.uri && (
          <a className="link" href={ipfsUrl(profile.data.uri)} target="_blank" rel="noreferrer">
            View profile metadata on IPFS
          </a>
        )}
      </section>
    </div>
  );
}
