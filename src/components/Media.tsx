import { useState } from 'react';
import { Avatar } from './ui';
import { ipfsUrl, uploadImage, type Profile } from '../lib/ipfs';
import { type Address } from 'viem';
import { shortAddress } from '../lib/format';
import { useQuery } from '../lib/query';
import { useWallet, openConnect } from '../lib/wallet';

export function TokenLogo({ uri, seed, size = 40 }: { uri?: string; seed: string; size?: number }) {
  const [failed, setFailed] = useState('');
  const url = ipfsUrl(uri);
  return url && failed !== uri ? (
    <img
      className="avatar token-logo"
      src={url}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(uri || '')}
    />
  ) : (
    <Avatar seed={seed} size={size} />
  );
}
export function TraderIdentity({ address, size = 28 }: { address: Address; size?: number }) {
  const profile = useQuery(
    `profile:${address.toLowerCase()}`,
    async () => {
      const response = await fetch(`/api/media/profiles/${address}`);
      if (!response.ok) throw new Error('Profile service unavailable');
      return (await response.json()) as Profile | null;
    },
    60_000,
  );
  return (
    <a className="row link" href={`#/profile/${address}`} title={address} style={{ gap: 8 }}>
      <TokenLogo uri={profile.data?.avatar} seed={address} size={size} />
      <span>{profile.data?.name || shortAddress(address)}</span>
    </a>
  );
}
export function ImageUpload({
  value,
  onChange,
  label,
  onBusy,
}: {
  value: string;
  onChange: (uri: string) => void;
  label: string;
  onBusy?: (busy: boolean) => void;
}) {
  const { address, provider } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <TokenLogo uri={value} seed={address || 'preview'} size={64} />
        {!address ? (
          <button className="btn btn-ghost" onClick={openConnect}>
            Connect to upload
          </button>
        ) : (
          <input
            aria-label={label}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file || !address || !provider) return;
              setBusy(true);
              onBusy?.(true);
              setError('');
              try {
                onChange(await uploadImage(file, address, provider));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Upload failed');
              } finally {
                setBusy(false);
                onBusy?.(false);
              }
            }}
          />
        )}
      </div>
      <span className="hint">
        {busy
          ? 'Sign in your wallet, then uploading to Pinata…'
          : 'PNG, JPEG or WebP, up to 2 MB. Public and stored on IPFS.'}
      </span>
      {value && (
        <button className="btn-quiet" disabled={busy} onClick={() => onChange('')}>
          Remove image
        </button>
      )}
      {error && (
        <p className="down" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
