import http from 'k6/http';
import { sleep } from 'k6';

export let options = {
  vus: 10000,
  duration: '30s',
};

export default function () {
  http.get('http://10.15.0.250');
  sleep(1);
}































