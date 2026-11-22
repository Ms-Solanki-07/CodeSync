import { io } from 'socket.io-client';

export const initSocket = () => {
    const options = {
        'forceConnection': true,
        'reconnectionAttempts': 'Infinity',
        'timeout': 10000,
        'transports': ['websocket'],
    };

    return io(process.env.REACT_APP_BACKEND_URL, options);
};