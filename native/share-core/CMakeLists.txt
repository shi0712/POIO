cmake_minimum_required(VERSION 3.24)

project(poio_share_core VERSION 0.1.0 LANGUAGES CXX)

if(NOT WIN32)
    message(FATAL_ERROR "POIO share core currently supports Windows only")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(
    POIO_SHARE_ENABLE_WEBRTC
    "Build the GPU-native WebRTC video source and Media Foundation encoder adapter"
    OFF
)
option(
    POIO_SHARE_ENABLE_MEDIASOUP
    "Build the native libmediasoupclient SFU publisher"
    OFF
)
set(
    POIO_LIBWEBRTC_SOURCE
    ""
    CACHE PATH
    "Path to the libwebrtc source checkout"
)
set(
    POIO_LIBWEBRTC_LIBRARY
    ""
    CACHE FILEPATH
    "Path to the optimized libwebrtc static library"
)
set(
    POIO_LIBMEDIASOUPCLIENT_SOURCE
    ""
    CACHE PATH
    "Path to the official libmediasoupclient source checkout"
)

if(POIO_SHARE_ENABLE_WEBRTC)
    # The official Chromium/WebRTC Windows toolchain is built with /MT.
    # Every object crossing the C++ ABI boundary must use the same CRT.
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

add_library(poio-share-core STATIC
    src/capture.cpp
    src/diagnostics.cpp
    src/h264.cpp
)

target_include_directories(poio-share-core
    PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
)

target_compile_definitions(poio-share-core
    PRIVATE
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        UNICODE
        _UNICODE
)

target_compile_options(poio-share-core PRIVATE /W4 /WX /permissive- /utf-8)

if(POIO_SHARE_ENABLE_WEBRTC)
    if(NOT IS_DIRECTORY "${POIO_LIBWEBRTC_SOURCE}/api")
        message(FATAL_ERROR "POIO_LIBWEBRTC_SOURCE must point to a complete libwebrtc source checkout")
    endif()
    if(NOT EXISTS "${POIO_LIBWEBRTC_LIBRARY}")
        message(FATAL_ERROR "POIO_LIBWEBRTC_LIBRARY must point to the built libwebrtc static library")
    endif()

    target_sources(poio-share-core PRIVATE
        src/p2p.cpp
        src/webrtc.cpp
    )
    target_include_directories(poio-share-core SYSTEM
        PUBLIC
            "${POIO_LIBWEBRTC_SOURCE}"
            "${POIO_LIBWEBRTC_SOURCE}/third_party/abseil-cpp"
    )
    target_compile_definitions(poio-share-core
        PUBLIC
            WEBRTC_WIN
        PRIVATE
            ABSL_ALLOCATOR_NOTHROW=1
    )
    target_link_libraries(poio-share-core PUBLIC "${POIO_LIBWEBRTC_LIBRARY}")
endif()

if(POIO_SHARE_ENABLE_MEDIASOUP)
    if(NOT POIO_SHARE_ENABLE_WEBRTC)
        message(FATAL_ERROR "POIO_SHARE_ENABLE_MEDIASOUP requires POIO_SHARE_ENABLE_WEBRTC")
    endif()
    if(NOT EXISTS "${POIO_LIBMEDIASOUPCLIENT_SOURCE}/CMakeLists.txt")
        message(FATAL_ERROR "POIO_LIBMEDIASOUPCLIENT_SOURCE must point to libmediasoupclient")
    endif()

    get_filename_component(POIO_LIBWEBRTC_BINARY_PATH "${POIO_LIBWEBRTC_LIBRARY}" DIRECTORY)
    set(LIBWEBRTC_INCLUDE_PATH "${POIO_LIBWEBRTC_SOURCE}" CACHE PATH "" FORCE)
    set(LIBWEBRTC_BINARY_PATH "${POIO_LIBWEBRTC_BINARY_PATH}" CACHE PATH "" FORCE)
    set(MEDIASOUPCLIENT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(MEDIASOUPCLIENT_BUILD_DEMO OFF CACHE BOOL "" FORCE)
    add_subdirectory(
        "${POIO_LIBMEDIASOUPCLIENT_SOURCE}"
        "${CMAKE_CURRENT_BINARY_DIR}/libmediasoupclient"
        EXCLUDE_FROM_ALL
    )

    target_sources(poio-share-core PRIVATE
        src/sfu.cpp
        src/session.cpp
    )
    target_include_directories(poio-share-core SYSTEM
        PUBLIC
            "${POIO_LIBMEDIASOUPCLIENT_SOURCE}/include"
    )
    target_link_libraries(poio-share-core PUBLIC mediasoupclient)

    add_executable(poio-share-sidecar
        src/sidecar_main.cpp
    )
    target_compile_definitions(poio-share-sidecar
        PRIVATE
            NOMINMAX
            WIN32_LEAN_AND_MEAN
            UNICODE
            _UNICODE
    )
    target_compile_options(poio-share-sidecar PRIVATE /W4 /WX /permissive- /utf-8)
    target_link_libraries(poio-share-sidecar PRIVATE poio-share-core)
endif()

target_link_libraries(poio-share-core
    PRIVATE
        d3d11
        dwmapi
        dxgi
        mf
        mfplat
        mfuuid
        dmoguids
        msdmo
        oleaut32
        runtimeobject
        winmm
        windowsapp
        wmcodecdspuuid
)

add_executable(poio-share-lab
    src/main.cpp
)

target_compile_definitions(poio-share-lab
    PRIVATE
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        UNICODE
        _UNICODE
)

target_compile_options(poio-share-lab PRIVATE /W4 /WX /permissive- /utf-8)
target_link_libraries(poio-share-lab PRIVATE poio-share-core)

include(CTest)
if(BUILD_TESTING)
    add_executable(poio-share-core-tests
        tests/diagnostics_tests.cpp
    )
    target_compile_definitions(poio-share-core-tests
        PRIVATE
            NOMINMAX
            WIN32_LEAN_AND_MEAN
            UNICODE
            _UNICODE
    )
    target_compile_options(poio-share-core-tests PRIVATE /W4 /WX /permissive- /utf-8)
    target_link_libraries(poio-share-core-tests PRIVATE poio-share-core)
    add_test(NAME poio-share-core-tests COMMAND poio-share-core-tests)

    if(POIO_SHARE_ENABLE_WEBRTC)
        add_executable(poio-share-webrtc-tests
            tests/webrtc_tests.cpp
        )
        target_compile_definitions(poio-share-webrtc-tests
            PRIVATE
                NOMINMAX
                WIN32_LEAN_AND_MEAN
                UNICODE
                _UNICODE
        )
        target_compile_options(poio-share-webrtc-tests PRIVATE /W4 /WX /permissive- /utf-8)
        target_link_libraries(poio-share-webrtc-tests
            PRIVATE
                poio-share-core
                d3d11
        )
        add_test(NAME poio-share-webrtc-tests COMMAND poio-share-webrtc-tests)

        add_executable(poio-share-p2p-tests
            tests/p2p_tests.cpp
        )
        target_compile_definitions(poio-share-p2p-tests
            PRIVATE
                NOMINMAX
                WIN32_LEAN_AND_MEAN
                UNICODE
                _UNICODE
        )
        target_compile_options(poio-share-p2p-tests PRIVATE /W4 /WX /permissive- /utf-8)
        target_link_libraries(poio-share-p2p-tests
            PRIVATE
                poio-share-core
                d3d11
        )
        add_test(NAME poio-share-p2p-tests COMMAND poio-share-p2p-tests)
    endif()

    if(POIO_SHARE_ENABLE_MEDIASOUP)
        add_executable(poio-share-sfu-tests
            tests/sfu_tests.cpp
        )
        target_compile_definitions(poio-share-sfu-tests
            PRIVATE
                NOMINMAX
                WIN32_LEAN_AND_MEAN
                UNICODE
                _UNICODE
        )
        target_compile_options(poio-share-sfu-tests PRIVATE /W4 /WX /permissive- /utf-8)
        target_link_libraries(poio-share-sfu-tests
            PRIVATE
                poio-share-core
                d3d11
        )
        add_test(NAME poio-share-sfu-tests COMMAND poio-share-sfu-tests)
    endif()
endif()
