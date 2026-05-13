const express = require('URL');
const expressRouter = require('express').Router();
const User = require('../models/User');
const DirectMessage = require('../models/DirectMessage');
const auth = require('../middleware/auth');

const router = expressRouter;

// Get Friends List
router.get('/', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('friends', 'username blitzRating role');
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        res.json({ friends: user.friends });
    } catch (err) {
        console.error('Error fetching friends:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Friend Requests
router.get('/requests', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('friendRequests.from', 'username blitzRating');
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        const pendingRequests = user.friendRequests.filter(req => req.status === 'pending');
        res.json({ requests: pendingRequests });
    } catch (err) {
        console.error('Error fetching requests:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send Friend Request
router.post('/request', auth, async (req, res) => {
    try {
        const { targetUsername } = req.body;
        const targetUser = await User.findOne({ username: new RegExp(`^${targetUsername}$`, 'i') });
        
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (targetUser._id.toString() === req.user.userId) {
            return res.status(400).json({ error: 'Cannot add yourself' });
        }

        const me = await User.findById(req.user.userId);
        
        if (me.friends.includes(targetUser._id)) {
            return res.status(400).json({ error: 'Already friends' });
        }

        const existingRequest = targetUser.friendRequests.find(
            r => r.from.toString() === req.user.userId && r.status === 'pending'
        );

        if (existingRequest) {
            return res.status(400).json({ error: 'Request already sent' });
        }

        targetUser.friendRequests.push({ from: req.user.userId, status: 'pending' });
        await targetUser.save();

        res.json({ success: true, message: 'Friend request sent' });
    } catch (err) {
        console.error('Error sending friend request:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Accept/Reject Friend Request
router.post('/respond', auth, async (req, res) => {
    try {
        const { requestId, accept } = req.body;
        const user = await User.findById(req.user.userId);
        
        const request = user.friendRequests.id(requestId);
        if (!request || request.status !== 'pending') {
            return res.status(400).json({ error: 'Invalid or already processed request' });
        }

        request.status = accept ? 'accepted' : 'rejected';

        if (accept) {
            if (!user.friends.includes(request.from)) {
                user.friends.push(request.from);
            }
            
            const sender = await User.findById(request.from);
            if (sender && !sender.friends.includes(user._id)) {
                sender.friends.push(user._id);
                await sender.save();
            }
        }

        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error('Error responding to request:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Direct Messages with a specific friend
router.get('/messages/:friendId', auth, async (req, res) => {
    try {
        const { friendId } = req.params;
        const messages = await DirectMessage.find({
            $or: [
                { senderId: req.user.userId, receiverId: friendId },
                { senderId: friendId, receiverId: req.user.userId }
            ]
        }).sort({ createdAt: 1 }).limit(50); // Get last 50 messages
        
        res.json({ messages });
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
