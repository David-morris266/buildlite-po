import { useMemo, useState } from 'react';
import { addUser, listUsers, updateUser } from '../../admin/userStore';
import AdminPageShell from './AdminPageShell';

const EMPTY_FORM = {
  name: '',
  role: 'Viewer',
  approvalRights: 'None',
  active: true,
};

export default function AdminUsersPage({ onBack }) {
  const [refresh, setRefresh] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const users = useMemo(() => {
    void refresh;
    return listUsers();
  }, [refresh]);

  function saveUser() {
    const result = editingId === 'new' ? addUser(form) : updateUser(editingId, form);
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
      eyebrow="Administration"
      title="Users"
      lead="Placeholder user directory. Authentication and permissions will be added in a future sprint."
      onBack={onBack}
    >
      <div className="admin-toolbar">
        <button type="button" className="po-btn-primary" onClick={() => { setEditingId('new'); setForm(EMPTY_FORM); }}>
          Add User
        </button>
      </div>

      <div className="po-table-wrap po-module-card">
        <table className="po-data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Approval Rights</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.role}</td>
                <td>{user.approvalRights}</td>
                <td>{user.active ? 'Yes' : 'No'}</td>
                <td>
                  <button type="button" className="cvr-summary__link-btn" onClick={() => { setEditingId(user.id); setForm(user); }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingId ? (
        <form className="admin-form po-module-card" onSubmit={(e) => { e.preventDefault(); saveUser(); }}>
          <div className="admin-form__grid">
            <label className="dev-form__field"><span className="dev-form__label">Name</span><input className="input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></label>
            <label className="dev-form__field"><span className="dev-form__label">Role</span><input className="input" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} /></label>
            <label className="dev-form__field admin-form__field--wide"><span className="dev-form__label">Approval Rights</span><input className="input" value={form.approvalRights} onChange={(e) => setForm((p) => ({ ...p, approvalRights: e.target.value }))} /></label>
            <label className="dev-form__field"><span className="dev-form__label">Active</span><select className="input" value={form.active ? 'yes' : 'no'} onChange={(e) => setForm((p) => ({ ...p, active: e.target.value === 'yes' }))}><option value="yes">Yes</option><option value="no">No</option></select></label>
          </div>
          <div className="admin-form__actions">
            <button type="submit" className="po-btn-primary">Save User</button>
            <button type="button" className="po-list-btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </AdminPageShell>
  );
}
