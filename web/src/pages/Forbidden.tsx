import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';

export function Forbidden() {
  return (
    <Empty icon={<ShieldAlert className="h-10 w-10" />} title="Acesso restrito"
      action={<Link to="/" className="text-sm font-medium text-brand-600 hover:underline">Voltar ao dashboard</Link>}>
      A área administrativa é exclusiva para administradores. O servidor e o banco de dados também bloqueiam esse acesso.
    </Empty>
  );
}
