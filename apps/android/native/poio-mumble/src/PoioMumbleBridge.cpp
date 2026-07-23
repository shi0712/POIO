// POIO Android JNI bridge for the pinned official mumble-voip/libmumble core.

#include <aaudio/AAudio.h>
#include <android/log.h>
#include <dlfcn.h>
#include <jni.h>

#include <mumble/IP.hpp>

#if POIO_HAS_FULL_LIBMUMBLE
#include <mumble/Connection.hpp>
#include <mumble/CryptOCB2.hpp>
#include <mumble/Lib.hpp>
#include <mumble/Message.hpp>
#include <mumble/Opus.hpp>
#include <mumble/Pack.hpp>
#include <mumble/Peer.hpp>
#include <mumble/Types.hpp>
#endif

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr char kTag[] = "POIO-Mumble";
constexpr char kBridgeClass[] = "cn/poio/mobile/voice/NativeMumbleVoiceEngine$NativeBridge";
#if POIO_HAS_FULL_LIBMUMBLE
constexpr int32_t kSampleRate = 48000;
constexpr int32_t kFrameSamples = 480;
constexpr int64_t kAudioTimeoutNanos = 50'000'000;
constexpr int64_t kTalkingHangoverMillis = 350;
#endif

JavaVM *g_vm = nullptr;

void throwIllegalState(JNIEnv *env, const std::string &message) {
    jclass type = env->FindClass("java/lang/IllegalStateException");
    if (type != nullptr) {
        env->ThrowNew(type, message.c_str());
        env->DeleteLocalRef(type);
    }
}

std::string utf8(JNIEnv *env, jstring value) {
    if (value == nullptr) return {};
    const char *chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}

class AttachedEnvironment {
public:
    AttachedEnvironment() {
        if (g_vm == nullptr) return;
        if (g_vm->GetEnv(reinterpret_cast<void **>(&m_env), JNI_VERSION_1_6) == JNI_OK) return;
        if (g_vm->AttachCurrentThread(&m_env, nullptr) == JNI_OK) m_attached = true;
    }

    ~AttachedEnvironment() {
        if (m_attached && g_vm != nullptr) g_vm->DetachCurrentThread();
    }

    JNIEnv *get() const { return m_env; }

private:
    JNIEnv *m_env = nullptr;
    bool m_attached = false;
};

#if POIO_HAS_FULL_LIBMUMBLE

class MumbleCryptState {
public:
    bool applySetup(
        const mumble::BufViewConst key,
        const mumble::BufViewConst clientNonce,
        const mumble::BufViewConst serverNonce
    ) {
        if (!key.empty()) {
            if (!m_encrypt.setKey(key) || !m_decrypt.setKey(key)) return false;
        }
        if (!clientNonce.empty()) {
            m_encryptNonce.assign(clientNonce.begin(), clientNonce.end());
            if (!m_encrypt.setNonce(m_encryptNonce)) return false;
        }
        if (!serverNonce.empty()) {
            m_decryptNonce.assign(serverNonce.begin(), serverNonce.end());
            if (!m_decrypt.setNonce(m_decryptNonce)) return false;
            m_decryptHistory.fill(0);
        }
        m_ready = !m_encryptNonce.empty() && !m_decryptNonce.empty();
        return m_ready;
    }

    bool ready() const { return m_ready; }

    size_t encrypt(const mumble::BufView out, const mumble::BufViewConst in) {
        if (!m_ready || out.size() < in.size() + 4 || in.size() > 1020) return 0;

        for (auto &byte : m_encryptNonce) {
            if (++*reinterpret_cast<uint8_t *>(&byte)) break;
        }
        if (!m_encrypt.setNonce(m_encryptNonce)) return 0;

        mumble::Buf tag(m_encrypt.blockSize());
        const auto written = m_encrypt.encrypt(out.subspan(4), in, tag);
        if (written == 0) return 0;
        out[0] = m_encryptNonce[0];
        std::copy_n(tag.cbegin(), 3, out.begin() + 1);
        return written + 4;
    }

    size_t decrypt(const mumble::BufView out, const mumble::BufViewConst in) {
        if (!m_ready || in.size() < 4) return 0;

        const auto nonceByte = static_cast<uint8_t>(in[0]);
        const auto tag = in.subspan(1, 3);
        const auto encrypted = in.subspan(4);
        const auto previousNonce = m_decryptNonce;
        gsl::span<uint8_t> nonce(
            reinterpret_cast<uint8_t *>(m_decryptNonce.data()),
            m_decryptNonce.size()
        );

        bool restore = false;
        if (((nonce[0] + 1) & 0xFF) == nonceByte) {
            if (nonceByte > nonce[0]) {
                nonce[0] = nonceByte;
            } else if (nonceByte < nonce[0]) {
                nonce[0] = nonceByte;
                for (size_t index = 1; index < nonce.size(); ++index) {
                    if (++nonce[index]) break;
                }
            } else {
                return 0;
            }
        } else {
            int32_t difference = nonceByte - nonce[0];
            if (difference > 128) difference -= 256;
            else if (difference < -128) difference += 256;

            if (nonceByte < nonce[0] && difference > -30 && difference < 0) {
                nonce[0] = nonceByte;
                restore = true;
            } else if (nonceByte > nonce[0] && difference > -30 && difference < 0) {
                nonce[0] = nonceByte;
                for (size_t index = 1; index < nonce.size(); ++index) {
                    if (nonce[index]--) break;
                }
                restore = true;
            } else if (nonceByte > nonce[0] && difference > 0) {
                nonce[0] = nonceByte;
            } else if (nonceByte < nonce[0] && difference > 0) {
                nonce[0] = nonceByte;
                for (size_t index = 1; index < nonce.size(); ++index) {
                    if (++nonce[index]) break;
                }
            } else {
                return 0;
            }

            if (m_decryptHistory[nonce[0]] == nonce[1]) {
                m_decryptNonce = previousNonce;
                return 0;
            }
        }

        if (!m_decrypt.setNonce(m_decryptNonce)) return 0;
        const auto written = m_decrypt.decrypt(out, encrypted, tag);
        if (written == 0) {
            m_decryptNonce = previousNonce;
            return 0;
        }

        m_decryptHistory[nonce[0]] = nonce[1];
        if (restore) m_decryptNonce = previousNonce;
        return written;
    }

private:
    mumble::CryptOCB2 m_encrypt;
    mumble::CryptOCB2 m_decrypt;
    mumble::Buf m_encryptNonce;
    mumble::Buf m_decryptNonce;
    std::array<uint8_t, UINT8_MAX + 1> m_decryptHistory{};
    bool m_ready = false;
};

class VoiceSession {
public:
    VoiceSession(JNIEnv *env, jobject callback, std::string channelName, int32_t inputDeviceId)
        : m_channelName(std::move(channelName)),
          m_inputDeviceId(inputDeviceId),
          m_callback(env->NewGlobalRef(callback)) {
        jclass type = env->GetObjectClass(callback);
        m_micLevelMethod = env->GetMethodID(type, "onNativeMicLevel", "(F)V");
        m_failureMethod = env->GetMethodID(type, "onNativeFailure", "(Ljava/lang/String;)V");
        m_userSessionMethod = env->GetMethodID(type, "onNativeUserSession", "(ILjava/lang/String;Z)V");
        m_userTalkingMethod = env->GetMethodID(type, "onNativeUserTalking", "(IZ)V");
        env->DeleteLocalRef(type);
    }

    ~VoiceSession() {
        stop();
        if (m_callback != nullptr) {
            AttachedEnvironment attached;
            if (attached.get() != nullptr) attached.get()->DeleteGlobalRef(m_callback);
            m_callback = nullptr;
        }
    }

    VoiceSession(const VoiceSession &) = delete;
    VoiceSession &operator=(const VoiceSession &) = delete;

    bool start(const std::string &host, uint16_t port, const std::string &username, const std::string &password) {
        const mumble::IP address(host);
        if (address.isWildcard()) return setStartupError("Mumble 服务器地址无效");
        m_serverEndpoint = {address, port};

        const auto connected = mumble::Peer::connect(m_serverEndpoint);
        if (connected.first != mumble::Code::Success) {
            return setStartupError("无法连接 Mumble TCP：" + codeText(connected.first));
        }

        m_connection = std::make_shared<mumble::Connection>(connected.second, false);
        const auto tls = (*m_connection)(connectionFeedback(username, password), [this]() { return m_stopRequested.load(); });
        if (tls != mumble::Code::Success) {
            return setStartupError("Mumble TLS 握手失败：" + codeText(tls));
        }

        auto code = m_peer.addTCP(m_connection);
        if (code != mumble::Code::Success) return setStartupError("注册 Mumble TCP 连接失败：" + codeText(code));

        code = m_peer.startTCP(peerFeedback(), 2);
        if (code != mumble::Code::Success) return setStartupError("启动 Mumble 网络线程失败：" + codeText(code));

        {
            std::unique_lock<std::mutex> lock(m_stateMutex);
            if (!m_readyCondition.wait_for(lock, std::chrono::seconds(15), [this]() {
                    return m_joined || !m_failure.empty() || m_stopRequested.load();
                })) {
                m_failure = "Mumble 登录或进入语音频道超时";
            }
            if (!m_failure.empty()) return false;
            if (!m_joined) return setStartupErrorLocked("Mumble 未能进入指定语音频道");
        }

        if (!openAudio()) return false;
        m_captureThread = std::thread(&VoiceSession::captureLoop, this);
        m_playbackThread = std::thread(&VoiceSession::playbackLoop, this);
        m_pingThread = std::thread(&VoiceSession::pingLoop, this);
        m_exposed = true;
        return true;
    }

    std::string startupError() const {
        std::lock_guard<std::mutex> lock(m_stateMutex);
        return m_failure.empty() ? "Mumble 原生语音启动失败" : m_failure;
    }

    void stop() {
        if (m_stopRequested.exchange(true)) return;

        m_readyCondition.notify_all();
        m_playbackCondition.notify_all();
        m_pingCondition.notify_all();
        if (m_input != nullptr) AAudioStream_requestStop(m_input);
        if (m_output != nullptr) AAudioStream_requestStop(m_output);

        m_peer.stopUDP();
        m_peer.stopTCP();
        if (m_captureThread.joinable()) m_captureThread.join();
        if (m_playbackThread.joinable()) m_playbackThread.join();
        if (m_pingThread.joinable()) m_pingThread.join();

        closeAudioStream(m_input);
        closeAudioStream(m_output);
        m_connection.reset();
    }

    void setMuted(bool muted) {
        m_muted = muted;
        sendSelfState();
    }

    void setDeafened(bool deafened) {
        m_deafened = deafened;
        if (deafened) m_muted = true;
        sendSelfState();
        if (deafened) {
            std::lock_guard<std::mutex> lock(m_playbackMutex);
            m_playbackQueue.clear();
        }
    }

    void setUserVolume(uint32_t session, int volume) {
        std::lock_guard<std::mutex> lock(m_decoderMutex);
        m_userVolumes[session] = std::clamp(volume, 0, 200);
    }

    void replayUserSessions() {
        std::vector<std::pair<uint32_t, std::string>> users;
        {
            std::lock_guard<std::mutex> lock(m_stateMutex);
            users.reserve(m_userNames.size());
            for (const auto &entry : m_userNames) users.push_back(entry);
        }
        for (const auto &[session, username] : users) notifyUserSession(session, username, true);
    }

private:
    static std::string codeText(mumble::Code code) {
        const auto value = mumble::text(code);
        return std::string(value.data(), value.size());
    }

    bool setStartupError(std::string message) {
        std::lock_guard<std::mutex> lock(m_stateMutex);
        return setStartupErrorLocked(std::move(message));
    }

    bool setStartupErrorLocked(std::string message) {
        if (m_failure.empty()) m_failure = std::move(message);
        m_readyCondition.notify_all();
        return false;
    }

    void fail(std::string message) {
        {
            std::lock_guard<std::mutex> lock(m_stateMutex);
            if (m_stopRequested.load() || !m_failure.empty()) return;
            m_failure = std::move(message);
        }
        m_readyCondition.notify_all();
        if (m_exposed.load()) notifyFailure();
    }

    mumble::Connection::Feedback connectionFeedback(const std::string &username, const std::string &password) {
        mumble::Connection::Feedback feedback;
        feedback.opened = [this, username, password]() {
            mumble::tcp::Message::Version version;
            version.version = mumble::lib::version();
            version.release = "POIO Android";
            version.os = "Android";
            if (!send(version)) return;

            mumble::tcp::Message::Authenticate auth;
            auth.username = username;
            auth.password = password;
            auth.opus = true;
            send(auth);
        };
        feedback.closed = [this]() { fail("Mumble TLS 连接已关闭"); };
        feedback.failed = [this](mumble::Code code) { fail("Mumble TLS 错误：" + codeText(code)); };
        feedback.timeout = []() { return 10000U; };
        feedback.timeouts = []() { return 2U; };
        feedback.pack = [this](mumble::tcp::Pack &pack) { handlePack(pack); };
        return feedback;
    }

    mumble::Peer::FeedbackTCP peerFeedback() {
        mumble::Peer::FeedbackTCP feedback;
        feedback.started = []() { __android_log_print(ANDROID_LOG_INFO, kTag, "Mumble TCP worker started"); };
        feedback.stopped = []() { __android_log_print(ANDROID_LOG_INFO, kTag, "Mumble TCP worker stopped"); };
        feedback.failed = [this](mumble::Code code) { fail("Mumble 网络线程错误：" + codeText(code)); };
        feedback.timeout = []() { return 10000U; };
        return feedback;
    }

    mumble::Peer::FeedbackUDP udpFeedback() {
        mumble::Peer::FeedbackUDP feedback;
        feedback.started = []() { __android_log_print(ANDROID_LOG_INFO, kTag, "Mumble UDP worker started"); };
        feedback.stopped = []() { __android_log_print(ANDROID_LOG_INFO, kTag, "Mumble UDP worker stopped"); };
        feedback.failed = [this](mumble::Code code) {
            m_udpConfirmed = false;
            __android_log_print(ANDROID_LOG_WARN, kTag, "Mumble UDP failed (%s), keeping TLS fallback", codeText(code).c_str());
        };
        feedback.timeout = []() { return 3000U; };
        feedback.encrypted = [this](mumble::Endpoint &, mumble::BufView packet) { handleEncryptedUdp(packet); };
        return feedback;
    }

    void startUdpTransport() {
        std::lock_guard<std::mutex> lock(m_udpStartMutex);
        if (m_udpStarted || m_stopRequested.load()) return;

        mumble::Endpoint local;
        auto code = m_peer.bindUDP(local);
        if (code != mumble::Code::Success) {
            __android_log_print(ANDROID_LOG_WARN, kTag, "Mumble UDP bind failed (%s)", codeText(code).c_str());
            return;
        }
        code = m_peer.startUDP(udpFeedback(), 4096);
        if (code != mumble::Code::Success) {
            m_peer.unbindUDP();
            __android_log_print(ANDROID_LOG_WARN, kTag, "Mumble UDP start failed (%s)", codeText(code).c_str());
            return;
        }
        m_udpStarted = true;
    }

    template<typename Message>
    bool send(const Message &message) {
        if (m_connection == nullptr || m_stopRequested.load()) return false;
        const mumble::tcp::Pack pack(message);
        std::lock_guard<std::mutex> lock(m_writeMutex);
        const auto code = m_connection->write(pack.buf(), true, [this]() { return m_stopRequested.load(); });
        if (code == mumble::Code::Success) return true;
        fail("发送 Mumble 数据失败：" + codeText(code));
        return false;
    }

    void handlePack(mumble::tcp::Pack &pack) {
        using Message = mumble::tcp::Message;
        switch (Message::type(pack)) {
            case Message::Type::Reject: {
                Message::Reject reject;
                if (pack(reject)) fail(reject.reason.empty() ? "Mumble 服务器拒绝登录" : reject.reason);
                break;
            }
            case Message::Type::ChannelState: {
                Message::ChannelState channel;
                if (pack(channel)) {
                    {
                        std::lock_guard<std::mutex> lock(m_stateMutex);
                        if (!channel.name.empty()) m_channels[channel.name] = channel.channelID;
                    }
                    tryJoinChannel();
                }
                break;
            }
            case Message::Type::ServerSync: {
                Message::ServerSync sync;
                if (pack(sync)) {
                    size_t channelCount = 0;
                    {
                        std::lock_guard<std::mutex> lock(m_stateMutex);
                        m_ownSession = sync.session;
                        m_serverSynchronized = true;
                        channelCount = m_channels.size();
                    }
                    __android_log_print(
                        ANDROID_LOG_INFO,
                        kTag,
                        "ServerSync session=%u channels=%zu target=%s",
                        sync.session,
                        channelCount,
                        m_channelName.c_str()
                    );
                    tryJoinChannel();
                }
                break;
            }
            case Message::Type::CryptSetup: {
                Message::CryptSetup setup;
                if (pack(setup)) {
                    bool configured = false;
                    {
                        std::lock_guard<std::mutex> lock(m_cryptoMutex);
                        configured = m_crypto.applySetup(setup.key, setup.clientNonce, setup.serverNonce);
                    }
                    if (configured) startUdpTransport();
                    else __android_log_print(ANDROID_LOG_WARN, kTag, "Mumble CryptSetup was incomplete; using TLS tunnel");
                }
                break;
            }
            case Message::Type::UserState: {
                Message::UserState state;
                if (pack(state)) {
                    bool announce = false;
                    {
                        std::lock_guard<std::mutex> lock(m_stateMutex);
                        if (!state.name.empty() && state.session != std::numeric_limits<uint32_t>::max()) {
                            m_userNames[state.session] = state.name;
                            announce = true;
                        }
                        if (m_joinRequested && state.session == m_ownSession && state.channelID == m_targetChannel) {
                            m_joined = true;
                            m_readyCondition.notify_all();
                        }
                    }
                    if (state.session == m_ownSession) {
                        __android_log_print(
                            ANDROID_LOG_INFO,
                            kTag,
                            "own UserState session=%u channel=%u target=%u joined=%d",
                            state.session,
                            state.channelID,
                            m_targetChannel,
                            m_joined ? 1 : 0
                        );
                    }
                    if (announce && m_exposed.load()) notifyUserSession(state.session, state.name, true);
                }
                break;
            }
            case Message::Type::PermissionDenied: {
                Message::PermissionDenied denied;
                if (pack(denied)) {
                    std::lock_guard<std::mutex> lock(m_stateMutex);
                    if (m_joinRequested && !m_joined) {
                        setStartupErrorLocked(
                            denied.reason.empty() ? "Mumble 服务器拒绝进入目标语音频道" : denied.reason
                        );
                    }
                }
                break;
            }
            case Message::Type::UserRemove: {
                Message::UserRemove removed;
                if (pack(removed)) {
                    {
                        std::lock_guard<std::mutex> lock(m_stateMutex);
                        m_userNames.erase(removed.session);
                    }
                    {
                        std::lock_guard<std::mutex> lock(m_decoderMutex);
                        m_decoders.erase(removed.session);
                        m_userVolumes.erase(removed.session);
                    }
                    clearUserTalking(removed.session);
                    if (m_exposed.load()) notifyUserSession(removed.session, {}, false);
                }
                break;
            }
            case Message::Type::UDPTunnel: {
                Message::UDPTunnel tunnel;
                if (pack(tunnel)) handleAudio(tunnel.pack);
                break;
            }
            default:
                break;
        }
    }

    void tryJoinChannel() {
        uint32_t ownSession = std::numeric_limits<uint32_t>::max();
        uint32_t target = std::numeric_limits<uint32_t>::max();
        {
            std::lock_guard<std::mutex> lock(m_stateMutex);
            if (!m_serverSynchronized || m_joinRequested) return;
            const auto found = m_channels.find(m_channelName);
            if (found == m_channels.end()) {
                setStartupErrorLocked("Mumble 中找不到语音频道：" + m_channelName);
                return;
            }
            ownSession = m_ownSession;
            target = found->second;
            m_targetChannel = target;
            m_joinRequested = true;
        }

        __android_log_print(
            ANDROID_LOG_INFO,
            kTag,
            "requesting channel move session=%u target=%u name=%s",
            ownSession,
            target,
            m_channelName.c_str()
        );
        if (!sendUserStateUpdate(ownSession, target, std::nullopt, std::nullopt)) {
            setStartupError("发送 Mumble 频道进入请求失败");
        }
    }

    void sendSelfState() {
        uint32_t ownSession;
        {
            std::lock_guard<std::mutex> lock(m_stateMutex);
            if (!m_joined) return;
            ownSession = m_ownSession;
        }
        sendUserStateUpdate(
            ownSession,
            std::nullopt,
            m_muted.load() || m_deafened.load(),
            m_deafened.load()
        );
    }

    static void appendProtoVarint(std::vector<std::byte> &payload, uint64_t value) {
        while (value >= 0x80) {
            payload.push_back(static_cast<std::byte>((value & 0x7f) | 0x80));
            value >>= 7;
        }
        payload.push_back(static_cast<std::byte>(value));
    }

    static void appendProtoVarintField(std::vector<std::byte> &payload, uint32_t field, uint64_t value) {
        appendProtoVarint(payload, static_cast<uint64_t>(field) << 3);
        appendProtoVarint(payload, value);
    }

    bool sendUserStateUpdate(
        uint32_t session,
        std::optional<uint32_t> channel,
        std::optional<bool> selfMute,
        std::optional<bool> selfDeaf
    ) {
        // libmumble's high-level UserState serializer writes every scalar,
        // including sentinel actor/session values and an empty name. That is
        // suitable for complete server snapshots but invalid for a client's
        // partial state update. Encode only the protobuf fields we intend to
        // change: session=1, channel_id=5, self_mute=9, self_deaf=10.
        std::vector<std::byte> payload;
        payload.reserve(24);
        appendProtoVarintField(payload, 1, session);
        if (channel) appendProtoVarintField(payload, 5, *channel);
        if (selfMute) appendProtoVarintField(payload, 9, *selfMute ? 1 : 0);
        if (selfDeaf) appendProtoVarintField(payload, 10, *selfDeaf ? 1 : 0);

        mumble::tcp::NetHeader header;
        header.type = mumble::Endian::toNetwork(
            static_cast<uint16_t>(mumble::tcp::Message::Type::UserState)
        );
        header.size = mumble::Endian::toNetwork(static_cast<uint32_t>(payload.size()));
        mumble::tcp::Pack pack(header);
        std::copy(payload.begin(), payload.end(), pack.data().begin());

        if (m_connection == nullptr || m_stopRequested.load()) return false;
        std::lock_guard<std::mutex> lock(m_writeMutex);
        const auto code = m_connection->write(pack.buf(), true, [this]() { return m_stopRequested.load(); });
        if (code == mumble::Code::Success) return true;
        fail("发送 Mumble 用户状态失败：" + codeText(code));
        return false;
    }

    bool openAudio() {
        if (!openAudioStream(AAUDIO_DIRECTION_INPUT, &m_input)) return false;
        if (!openAudioStream(AAUDIO_DIRECTION_OUTPUT, &m_output)) return false;

        if (AAudioStream_getSampleRate(m_input) != kSampleRate || AAudioStream_getChannelCount(m_input) != 1
            || AAudioStream_getSampleRate(m_output) != kSampleRate || AAudioStream_getChannelCount(m_output) != 1) {
            return setStartupError("设备无法提供 48 kHz 单声道低延迟音频流");
        }

        const auto inputStart = AAudioStream_requestStart(m_input);
        const auto outputStart = AAudioStream_requestStart(m_output);
        if (inputStart != AAUDIO_OK || outputStart != AAUDIO_OK) {
            return setStartupError("启动 Android 低延迟音频流失败");
        }
        return true;
    }

    bool openAudioStream(aaudio_direction_t direction, AAudioStream **stream) {
        AAudioStreamBuilder *builder = nullptr;
        aaudio_result_t result = AAudio_createStreamBuilder(&builder);
        if (result != AAUDIO_OK || builder == nullptr) {
            return setStartupError("创建 Android 音频流失败");
        }

        AAudioStreamBuilder_setDirection(builder, direction);
        AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_I16);
        AAudioStreamBuilder_setSampleRate(builder, kSampleRate);
        AAudioStreamBuilder_setChannelCount(builder, 1);
        AAudioStreamBuilder_setPerformanceMode(builder, AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
        AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_EXCLUSIVE);
        if (direction == AAUDIO_DIRECTION_INPUT && m_inputDeviceId > AAUDIO_UNSPECIFIED) {
            AAudioStreamBuilder_setDeviceId(builder, m_inputDeviceId);
        }
        configureVoiceStream(builder, direction);
        result = AAudioStreamBuilder_openStream(builder, stream);
        if (result != AAUDIO_OK) {
            AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
            result = AAudioStreamBuilder_openStream(builder, stream);
        }
        if (result != AAUDIO_OK && direction == AAUDIO_DIRECTION_INPUT && m_inputDeviceId > AAUDIO_UNSPECIFIED) {
            __android_log_print(
                ANDROID_LOG_WARN,
                kTag,
                "preferred input device %d unavailable, falling back to system default",
                m_inputDeviceId
            );
            AAudioStreamBuilder_setDeviceId(builder, AAUDIO_UNSPECIFIED);
            result = AAudioStreamBuilder_openStream(builder, stream);
        }
        AAudioStreamBuilder_delete(builder);

        if (result != AAUDIO_OK || *stream == nullptr) {
            return setStartupError(std::string("打开 Android 音频设备失败：") + AAudio_convertResultToText(result));
        }

        const int32_t burst = AAudioStream_getFramesPerBurst(*stream);
        if (burst > 0) AAudioStream_setBufferSizeInFrames(*stream, burst * 2);
        return true;
    }

    static void configureVoiceStream(AAudioStreamBuilder *builder, aaudio_direction_t direction) {
        // Usage/input-preset setters were added in Android 9. Resolve them at
        // runtime so the APK still loads on the declared Android 8 minimum.
        void *library = dlopen("libaaudio.so", RTLD_NOW | RTLD_LOCAL);
        if (library == nullptr) return;
        if (direction == AAUDIO_DIRECTION_INPUT) {
            using Setter = void (*)(AAudioStreamBuilder *, aaudio_input_preset_t);
            auto setter = reinterpret_cast<Setter>(dlsym(library, "AAudioStreamBuilder_setInputPreset"));
            if (setter != nullptr) setter(builder, AAUDIO_INPUT_PRESET_VOICE_COMMUNICATION);
        } else {
            using UsageSetter = void (*)(AAudioStreamBuilder *, aaudio_usage_t);
            using ContentSetter = void (*)(AAudioStreamBuilder *, aaudio_content_type_t);
            auto usage = reinterpret_cast<UsageSetter>(dlsym(library, "AAudioStreamBuilder_setUsage"));
            auto content = reinterpret_cast<ContentSetter>(dlsym(library, "AAudioStreamBuilder_setContentType"));
            if (usage != nullptr) usage(builder, AAUDIO_USAGE_VOICE_COMMUNICATION);
            if (content != nullptr) content(builder, AAUDIO_CONTENT_TYPE_SPEECH);
        }
        dlclose(library);
    }

    static void closeAudioStream(AAudioStream *&stream) {
        if (stream == nullptr) return;
        AAudioStream_close(stream);
        stream = nullptr;
    }

    bool sendEncryptedUdp(const mumble::udp::Pack &packet) {
        if (!m_udpStarted.load() || m_stopRequested.load()) return false;

        mumble::Buf encrypted(packet.buf().size() + 4);
        size_t written = 0;
        {
            std::lock_guard<std::mutex> lock(m_cryptoMutex);
            written = m_crypto.encrypt(encrypted, packet.buf());
        }
        if (written == 0) return false;
        encrypted.resize(written);
        return m_peer.sendUDP(m_serverEndpoint, encrypted) == mumble::Code::Success;
    }

    bool sendAudio(const mumble::udp::Message::Audio &audio) {
        const mumble::udp::Pack packet(audio);
        const auto lastUdpPacket = m_lastUdpPacketNanos.load();
        const bool udpFresh = m_udpConfirmed.load()
            && lastUdpPacket > 0
            && steadyNanos() - lastUdpPacket < std::chrono::duration_cast<std::chrono::nanoseconds>(
                std::chrono::seconds(10)
            ).count();
        if (udpFresh && sendEncryptedUdp(packet)) return true;
        if (!udpFresh) m_udpConfirmed = false;

        mumble::tcp::Message::UDPTunnel tunnel;
        tunnel.pack = packet;
        return send(tunnel);
    }

    void handleEncryptedUdp(const mumble::BufViewConst encrypted) {
        if (encrypted.size() <= 4 || m_stopRequested.load()) return;

        mumble::Buf plain(encrypted.size() - 4);
        size_t written = 0;
        {
            std::lock_guard<std::mutex> lock(m_cryptoMutex);
            written = m_crypto.decrypt(plain, encrypted);
        }
        if (written == 0) return;
        plain.resize(written);

        mumble::udp::Pack packet(mumble::udp::NetHeader{}, written > 0 ? static_cast<uint32_t>(written - 1) : 0);
        std::copy(plain.cbegin(), plain.cend(), packet.buf().begin());
        m_udpConfirmed = true;
        m_lastUdpPacketNanos = steadyNanos();

        if (mumble::udp::Message::type(packet) == mumble::udp::Message::Type::Audio) {
            handleAudio(packet);
        }
    }

    static int64_t steadyNanos() {
        return std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();
    }

    void pingLoop() {
        uint32_t tick = 0;
        while (!m_stopRequested.load()) {
            if (m_udpStarted.load()) {
                mumble::udp::Message::Ping ping;
                ping.requestExtendedInformation = false;
                sendEncryptedUdp(mumble::udp::Pack(ping));
            }
            if ((tick++ % 2U) == 0U) {
                mumble::tcp::Message::Ping ping;
                if (!send(ping)) return;
            }

            std::unique_lock<std::mutex> lock(m_pingMutex);
            m_pingCondition.wait_for(lock, std::chrono::seconds(3), [this]() { return m_stopRequested.load(); });
        }
    }

    void captureLoop() {
        mumble::Opus::Encoder encoder(1);
        if (encoder.init(kSampleRate, mumble::Opus::Encoder::Preset::VoIP) != mumble::Code::Success) {
            fail("初始化 Mumble Opus 编码器失败");
            return;
        }
        encoder.setBitrate(64000);

        std::vector<int16_t> pcm(kFrameSamples);
        mumble::Buf compressed(4096);
        int32_t filled = 0;
        uint32_t levelTick = 0;
        uint32_t voiceHangover = 0;
        bool transmitting = false;

        while (!m_stopRequested.load()) {
            const auto result = AAudioStream_read(
                m_input,
                pcm.data() + filled,
                kFrameSamples - filled,
                kAudioTimeoutNanos
            );
            if (result == AAUDIO_ERROR_TIMEOUT) continue;
            if (result < 0) {
                if (!m_stopRequested.load()) fail(std::string("读取麦克风失败：") + AAudio_convertResultToText(result));
                break;
            }
            filled += result;
            if (filled < kFrameSamples) continue;
            filled = 0;

            int32_t peak = 0;
            for (const int16_t sample : pcm) peak = std::max(peak, std::abs(static_cast<int32_t>(sample)));
            if ((++levelTick % 5U) == 0U) notifyMicLevel(static_cast<float>(peak) / 32767.0F);
            const uint64_t frameNumber = m_frameNumber.fetch_add(1);

            if (peak >= 350) voiceHangover = 20;
            else if (voiceHangover > 0) --voiceHangover;
            const bool shouldTransmit = !m_muted.load() && !m_deafened.load() && voiceHangover > 0;
            if (!shouldTransmit) {
                if (transmitting) {
                    mumble::udp::Message::Audio terminator;
                    terminator.direction = mumble::udp::Message::Audio::ClientToServer;
                    terminator.target = 0;
                    terminator.frameNumber = frameNumber;
                    terminator.isTerminator = true;
                    sendAudio(terminator);
                    transmitting = false;
                }
                continue;
            }
            transmitting = true;

            const auto encoded = encoder(compressed, pcm);
            if (encoded.empty()) continue;

            mumble::udp::Message::Audio audio;
            audio.direction = mumble::udp::Message::Audio::ClientToServer;
            audio.target = 0;
            audio.frameNumber = frameNumber;
            audio.opusData.assign(encoded.begin(), encoded.end());

            if (!sendAudio(audio)) break;
        }
    }

    void handleAudio(const mumble::udp::Pack &pack) {
        if (m_stopRequested.load() || m_deafened.load()) return;
        if (mumble::udp::Message::type(pack) != mumble::udp::Message::Type::Audio) return;

        mumble::udp::Message::Audio audio;
        if (!pack(audio) || !audio.senderSession.has_value() || audio.opusData.empty()) return;
        const uint32_t sender = *audio.senderSession;

        std::vector<int16_t> decoded;
        {
            std::lock_guard<std::mutex> lock(m_decoderMutex);
            auto &decoder = m_decoders[sender];
            if (!decoder) {
                decoder = std::make_unique<mumble::Opus::Decoder>(1);
                if (decoder->init(kSampleRate) != mumble::Code::Success) {
                    m_decoders.erase(sender);
                    return;
                }
            }

            const uint32_t samples = decoder->packetSamples(audio.opusData);
            if (samples == 0 || samples > 5760) return;
            decoded.resize(samples);
            const auto output = (*decoder)(decoded, audio.opusData);
            decoded.resize(output.size());

            const int volume = m_userVolumes.count(sender) == 0 ? 100 : m_userVolumes[sender];
            if (volume != 100) {
                const float gain = static_cast<float>(volume) / 100.0F;
                for (int16_t &sample : decoded) {
                    const auto scaled = static_cast<int32_t>(std::lrint(static_cast<float>(sample) * gain));
                    sample = static_cast<int16_t>(std::clamp(scaled, -32768, 32767));
                }
            }
        }

        if (decoded.empty()) return;
        if (m_exposed.load()) markUserTalking(sender);
        {
            std::lock_guard<std::mutex> lock(m_playbackMutex);
            if (m_playbackQueue.size() >= 24) m_playbackQueue.pop_front();
            m_playbackQueue.push_back(std::move(decoded));
        }
        m_playbackCondition.notify_one();
    }

    void playbackLoop() {
        while (!m_stopRequested.load()) {
            std::vector<int16_t> pcm;
            {
                std::unique_lock<std::mutex> lock(m_playbackMutex);
                m_playbackCondition.wait_for(lock, std::chrono::milliseconds(100), [this]() {
                    return m_stopRequested.load() || !m_playbackQueue.empty();
                });
                if (m_stopRequested.load()) break;
                if (!m_playbackQueue.empty()) {
                    pcm = std::move(m_playbackQueue.front());
                    m_playbackQueue.pop_front();
                }
            }

            expireTalkingUsers();
            if (pcm.empty()) continue;

            int32_t written = 0;
            while (written < static_cast<int32_t>(pcm.size()) && !m_stopRequested.load()) {
                const auto result = AAudioStream_write(
                    m_output,
                    pcm.data() + written,
                    static_cast<int32_t>(pcm.size()) - written,
                    kAudioTimeoutNanos
                );
                if (result == AAUDIO_ERROR_TIMEOUT) continue;
                if (result < 0) {
                    if (!m_stopRequested.load()) fail(std::string("播放语音失败：") + AAudio_convertResultToText(result));
                    return;
                }
                written += result;
            }
            expireTalkingUsers();
        }
    }

    void markUserTalking(uint32_t session) {
        const auto deadline = std::chrono::steady_clock::now()
            + std::chrono::milliseconds(kTalkingHangoverMillis);
        std::lock_guard<std::mutex> lock(m_talkingMutex);
        const auto [position, inserted] = m_talkingUntil.emplace(session, deadline);
        if (!inserted) {
            position->second = deadline;
            return;
        }
        notifyUserTalking(session, true);
    }

    void clearUserTalking(uint32_t session) {
        std::lock_guard<std::mutex> lock(m_talkingMutex);
        if (m_talkingUntil.erase(session) != 0 && m_exposed.load()) {
            notifyUserTalking(session, false);
        }
    }

    void expireTalkingUsers() {
        const auto now = std::chrono::steady_clock::now();
        std::lock_guard<std::mutex> lock(m_talkingMutex);
        for (auto current = m_talkingUntil.begin(); current != m_talkingUntil.end();) {
            if (current->second > now) {
                ++current;
                continue;
            }
            const uint32_t session = current->first;
            current = m_talkingUntil.erase(current);
            if (m_exposed.load()) notifyUserTalking(session, false);
        }
    }

    void notifyMicLevel(float level) {
        if (m_callback == nullptr || m_micLevelMethod == nullptr) return;
        AttachedEnvironment attached;
        JNIEnv *env = attached.get();
        if (env == nullptr) return;
        env->CallVoidMethod(m_callback, m_micLevelMethod, std::clamp(level, 0.0F, 1.0F));
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    void notifyUserSession(uint32_t session, const std::string &username, bool present) {
        if (m_callback == nullptr || m_userSessionMethod == nullptr) return;
        AttachedEnvironment attached;
        JNIEnv *env = attached.get();
        if (env == nullptr) return;
        jstring name = env->NewStringUTF(username.c_str());
        if (name != nullptr) {
            env->CallVoidMethod(
                m_callback,
                m_userSessionMethod,
                static_cast<jint>(session),
                name,
                present ? JNI_TRUE : JNI_FALSE
            );
            env->DeleteLocalRef(name);
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    void notifyUserTalking(uint32_t session, bool talking) {
        if (m_callback == nullptr || m_userTalkingMethod == nullptr) return;
        AttachedEnvironment attached;
        JNIEnv *env = attached.get();
        if (env == nullptr) return;
        env->CallVoidMethod(
            m_callback,
            m_userTalkingMethod,
            static_cast<jint>(session),
            talking ? JNI_TRUE : JNI_FALSE
        );
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    void notifyFailure() {
        if (m_callback == nullptr || m_failureMethod == nullptr) return;
        std::string message;
        {
            std::lock_guard<std::mutex> lock(m_stateMutex);
            message = m_failure;
        }
        AttachedEnvironment attached;
        JNIEnv *env = attached.get();
        if (env == nullptr) return;
        jstring text = env->NewStringUTF(message.c_str());
        if (text != nullptr) {
            env->CallVoidMethod(m_callback, m_failureMethod, text);
            env->DeleteLocalRef(text);
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    std::string m_channelName;
    int32_t m_inputDeviceId = AAUDIO_UNSPECIFIED;
    jobject m_callback = nullptr;
    jmethodID m_micLevelMethod = nullptr;
    jmethodID m_failureMethod = nullptr;
    jmethodID m_userSessionMethod = nullptr;
    jmethodID m_userTalkingMethod = nullptr;

    mumble::Peer m_peer;
    std::shared_ptr<mumble::Connection> m_connection;
    mumble::Endpoint m_serverEndpoint;
    AAudioStream *m_input = nullptr;
    AAudioStream *m_output = nullptr;
    std::thread m_captureThread;
    std::thread m_playbackThread;
    std::thread m_pingThread;

    mutable std::mutex m_stateMutex;
    std::condition_variable m_readyCondition;
    std::string m_failure;
    std::unordered_map<std::string, uint32_t> m_channels;
    std::unordered_map<uint32_t, std::string> m_userNames;
    uint32_t m_ownSession = std::numeric_limits<uint32_t>::max();
    uint32_t m_targetChannel = std::numeric_limits<uint32_t>::max();
    bool m_serverSynchronized = false;
    bool m_joinRequested = false;
    bool m_joined = false;

    std::mutex m_writeMutex;
    std::mutex m_udpStartMutex;
    std::mutex m_cryptoMutex;
    MumbleCryptState m_crypto;
    std::atomic<bool> m_udpStarted{false};
    std::atomic<bool> m_udpConfirmed{false};
    std::atomic<int64_t> m_lastUdpPacketNanos{0};

    std::mutex m_decoderMutex;
    std::unordered_map<uint32_t, std::unique_ptr<mumble::Opus::Decoder>> m_decoders;
    std::unordered_map<uint32_t, int> m_userVolumes;

    std::mutex m_talkingMutex;
    std::unordered_map<uint32_t, std::chrono::steady_clock::time_point> m_talkingUntil;

    std::mutex m_playbackMutex;
    std::condition_variable m_playbackCondition;
    std::deque<std::vector<int16_t>> m_playbackQueue;

    std::mutex m_pingMutex;
    std::condition_variable m_pingCondition;

    std::atomic<bool> m_stopRequested{false};
    std::atomic<bool> m_exposed{false};
    std::atomic<bool> m_muted{false};
    std::atomic<bool> m_deafened{false};
    std::atomic<uint64_t> m_frameNumber{0};
};

#endif

jstring coreVersion(JNIEnv *env, jobject) {
#if POIO_HAS_FULL_LIBMUMBLE
    const auto version = mumble::lib::version();
    const std::string value = std::string("libmumble ") + std::to_string(version.major) + "."
        + std::to_string(version.minor) + "." + std::to_string(version.patch) + "@" + POIO_LIBMUMBLE_COMMIT
        + "/udp-ocb2-opus-aaudio-partial-userstate";
#else
    const std::string value = std::string("libmumble@") + POIO_LIBMUMBLE_COMMIT + "/ip-probe";
#endif
    return env->NewStringUTF(value.c_str());
}

jlong connect(
    JNIEnv *env,
    jobject,
    jstring hostValue,
    jint port,
    jstring usernameValue,
    jstring passwordValue,
    jstring channelValue,
    jint inputDeviceId,
    jobject callback
) {
    const std::string host = utf8(env, hostValue);
    const std::string username = utf8(env, usernameValue);
    const std::string password = utf8(env, passwordValue);
    const std::string channel = utf8(env, channelValue);
    if (host.empty() || username.empty() || channel.empty() || callback == nullptr || port <= 0 || port > UINT16_MAX) {
        throwIllegalState(env, "Mumble 连接参数无效");
        return 0;
    }

#if POIO_HAS_FULL_LIBMUMBLE
    auto session = std::make_unique<VoiceSession>(env, callback, channel, inputDeviceId);
    if (!session->start(host, static_cast<uint16_t>(port), username, password)) {
        const std::string message = session->startupError();
        session.reset();
        throwIllegalState(env, message);
        return 0;
    }
    __android_log_print(ANDROID_LOG_INFO, kTag, "connected to %s:%d channel=%s", host.c_str(), port, channel.c_str());
    return reinterpret_cast<jlong>(session.release());
#else
    const mumble::IP peerAddress(host);
    __android_log_print(
        ANDROID_LOG_INFO,
        kTag,
        "IP-only ABI probe host=%s normalized=%s commit=%s",
        host.c_str(),
        peerAddress.text().c_str(),
        POIO_LIBMUMBLE_COMMIT
    );
    throwIllegalState(env, "当前设备 ABI 尚未包含完整 Mumble TLS、Opus 与 AAudio 核心，请使用 arm64-v8a 设备");
    return 0;
#endif
}

void disconnect(JNIEnv *, jobject, jlong handle) {
#if POIO_HAS_FULL_LIBMUMBLE
    delete reinterpret_cast<VoiceSession *>(handle);
#else
    (void)handle;
#endif
}

void setMuted(JNIEnv *env, jobject, jlong handle, jboolean muted) {
#if POIO_HAS_FULL_LIBMUMBLE
    auto *session = reinterpret_cast<VoiceSession *>(handle);
    if (session == nullptr) return throwIllegalState(env, "尚未连接 Mumble 语音频道");
    session->setMuted(muted == JNI_TRUE);
#else
    (void)muted;
    if (handle == 0) throwIllegalState(env, "尚未连接 Mumble 语音频道");
#endif
}

void setDeafened(JNIEnv *env, jobject, jlong handle, jboolean deafened) {
#if POIO_HAS_FULL_LIBMUMBLE
    auto *session = reinterpret_cast<VoiceSession *>(handle);
    if (session == nullptr) return throwIllegalState(env, "尚未连接 Mumble 语音频道");
    session->setDeafened(deafened == JNI_TRUE);
#else
    (void)deafened;
    if (handle == 0) throwIllegalState(env, "尚未连接 Mumble 语音频道");
#endif
}

void setUserVolume(JNIEnv *env, jobject, jlong handle, jint sessionId, jint volume) {
#if POIO_HAS_FULL_LIBMUMBLE
    auto *session = reinterpret_cast<VoiceSession *>(handle);
    if (session == nullptr) return throwIllegalState(env, "尚未连接 Mumble 语音频道");
    if (sessionId < 0) return throwIllegalState(env, "Mumble 用户会话编号无效");
    session->setUserVolume(static_cast<uint32_t>(sessionId), volume);
#else
    (void)sessionId;
    (void)volume;
    if (handle == 0) throwIllegalState(env, "尚未连接 Mumble 语音频道");
#endif
}

void requestUserSessions(JNIEnv *env, jobject, jlong handle) {
#if POIO_HAS_FULL_LIBMUMBLE
    auto *session = reinterpret_cast<VoiceSession *>(handle);
    if (session == nullptr) return throwIllegalState(env, "尚未连接 Mumble 语音频道");
    session->replayUserSessions();
#else
    if (handle == 0) throwIllegalState(env, "尚未连接 Mumble 语音频道");
#endif
}

JNINativeMethod methods[] = {
    {const_cast<char *>("coreVersion"), const_cast<char *>("()Ljava/lang/String;"), reinterpret_cast<void *>(coreVersion)},
    {const_cast<char *>("connect"), const_cast<char *>("(Ljava/lang/String;ILjava/lang/String;Ljava/lang/String;Ljava/lang/String;ILcn/poio/mobile/voice/NativeMumbleVoiceEngine;)J"), reinterpret_cast<void *>(connect)},
    {const_cast<char *>("disconnect"), const_cast<char *>("(J)V"), reinterpret_cast<void *>(disconnect)},
    {const_cast<char *>("setMuted"), const_cast<char *>("(JZ)V"), reinterpret_cast<void *>(setMuted)},
    {const_cast<char *>("setDeafened"), const_cast<char *>("(JZ)V"), reinterpret_cast<void *>(setDeafened)},
    {const_cast<char *>("setUserVolume"), const_cast<char *>("(JII)V"), reinterpret_cast<void *>(setUserVolume)},
    {const_cast<char *>("requestUserSessions"), const_cast<char *>("(J)V"), reinterpret_cast<void *>(requestUserSessions)},
};

} // namespace

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
    g_vm = vm;
    JNIEnv *env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK || env == nullptr) return JNI_ERR;

#if POIO_HAS_FULL_LIBMUMBLE
    if (mumble::lib::init() != mumble::Code::Success) return JNI_ERR;
#endif

    jclass bridge = env->FindClass(kBridgeClass);
    if (bridge == nullptr) return JNI_ERR;
    const jint result = env->RegisterNatives(bridge, methods, static_cast<jint>(std::size(methods)));
    env->DeleteLocalRef(bridge);
    if (result != JNI_OK) return JNI_ERR;

    __android_log_print(
        ANDROID_LOG_INFO,
        kTag,
        "loaded libmumble commit %s full=%d",
        POIO_LIBMUMBLE_COMMIT,
        POIO_HAS_FULL_LIBMUMBLE
    );
    return JNI_VERSION_1_6;
}

JNIEXPORT void JNICALL JNI_OnUnload(JavaVM *, void *) {
#if POIO_HAS_FULL_LIBMUMBLE
    mumble::lib::deinit();
#endif
    g_vm = nullptr;
}
