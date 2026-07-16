import { useMemo, useState } from 'react';
import { addClient, listClients, updateClient } from '../../admin/clientStore';
import AdminPageShell from './AdminPageShell';
import {
  AdminButton,
  AdminDataTable,
  AdminEmptyState,
  AdminKpiGrid,
  AdminStatusBadge,
} from './adminUi';

const EMPTY_FORM = { name: '', address: '', contact: '', active: true };

export default function AdminClientsPage({ onBack }) {
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const clients = useMemo(() => {
    void refresh;
    return listClients();
  }, [refresh]);

  const filteredClients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) =>
      [client.name, client.address, client.contact].join(' ').toLowerCase().includes(needle)
    );
  }, [clients, search]);

  function saveClient() {
    const result = editingId === 'new' ? addClient(form) : updateClient(editingId, form);
    if (!result.ok) {
      window.alert(result.errors?.[0]);
      return;
    }
    setEditingId(null);
    setForm(EMPTY_FORM);
    setRefresh((value) => value + 1);
  }

  return (
    <AdminPageShell
      title="Clients"
      lead="Client master records for developments and future revenue modules."
      onBack={onBack}
      actions={
        <AdminButton variant="primary" onClick={() => { setEditingId('new'); setForm(EMPTY_FORM); }}>
          Add Client
        </AdminButton>
      }
    >
      <AdminKpiGrid
        items={[
          { label: 'Total Clients', value: clients.length },
          { label: 'Active', value: clients.filter((item) => item.active).length, tone: 'success' },
          { label: 'Inactive', value: clients.filter((item) => !item.active).length },
        ]}
      />

      <label className="admin-search admin-search--inline">
        <span className="admin-search__label">Search clients</span>
        <input className="input admin-search__input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, address or contact" />
      </label>

      {filteredClients.length === 0 ? (
        <AdminEmptyState
          icon="✓"
          title="No clients found"
          message={search ? 'Try a different search term.' : 'Add your first client to get started.'}
        />
      ) : (
        <AdminDataTable>
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Address</th>
              <th>Contact</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredClients.map((client) => (
              <tr key={client.id}>
                <td><strong>{client.name}</strong></td>
                <td>{client.address || '—'}</td>
                <td>{client.contact || '—'}</td>
                <td>
                  <AdminStatusBadge tone={client.active ? 'success' : 'muted'}>
                    {client.active ? 'Active' : 'Inactive'}
                  </AdminStatusBadge>
                </td>
                <td>
                  <AdminButton variant="ghost" onClick={() => { setEditingId(client.id); setForm(client); }}>Edit</AdminButton>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminDataTable>
      )}

      {editingId ? (
        <form className="admin-form po-module-card admin-fade-in" onSubmit={(e) => { e.preventDefault(); saveClient(); }}>
          <h2 className="admin-form__section-title">{editingId === 'new' ? 'Add Client' : 'Edit Client'}</h2>
          <div className="admin-form__grid">
            <label className="dev-form__field"><span className="dev-form__label">Client Name</span><input className="input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></label>
            <label className="dev-form__field admin-form__field--wide"><span className="dev-form__label">Address</span><textarea className="input" rows={3} value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} /></label>
            <label className="dev-form__field"><span className="dev-form__label">Contact</span><input className="input" value={form.contact} onChange={(e) => setForm((p) => ({ ...p, contact: e.target.value }))} /></label>
            <label className="dev-form__field"><span className="dev-form__label">Active</span><select className="input" value={form.active ? 'yes' : 'no'} onChange={(e) => setForm((p) => ({ ...p, active: e.target.value === 'yes' }))}><option value="yes">Yes</option><option value="no">No</option></select></label>
          </div>
          <div className="admin-form__actions">
            <AdminButton type="submit" variant="primary">Save Client</AdminButton>
            <AdminButton variant="secondary" onClick={() => setEditingId(null)}>Cancel</AdminButton>
          </div>
        </form>
      ) : null}
    </AdminPageShell>
  );
}
