import './styles.css';
import './ui/gn/gn.css';
import { App } from './ui/app';
import { GameNight } from './ui/gn/app';

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
// Classic Esrever: its own mode, and its old room links (`?room=CODE`) keep working.
if (params.get('mode') === 'classic' || params.has('room')) new App(root);
else new GameNight(root);
