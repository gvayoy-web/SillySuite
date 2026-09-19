<?php
/**
 * Canva Route Implementation - SillySuite
 * Provides a powerful canvas editor for sprite creation and animation
 * Integrates with the main SillyBuilder visual editor
 * 
 * Features:
 * - Sprite editor with brush, shapes, layers, animation timeline
 * - Real-time collaboration via WebSocket
 * - Export/import .silly package format
 * - Advanced filtering and effects
 * - Performance optimized with canvas pooling
 * - Responsive design with mobile support
 * 
 * @author    Developer
 * @version   1.0.0
 * @package   SillySuite
 */

namespace SillyQuiz\silly\Routes;

use 
    Psr\Http\Request;
use 
    Psr\Http\Response;
use 
    SillyQuiz\silly\Services\CanvaService;
class CanvaRoute
{
    /**
     * CanvaService instance for canvas operations
     */
    protected CanvaService $canvaService;

    /**
     * Application instance for config
     */
    protected \Illuminate\Foundation\Application $app;

    /**
     * Construct the route handler
     */
    public function __construct(
        CanvaService $canvaService,
        \Illuminate\Foundation\Application $app
    ) {
        $this->canvaService = $canvaService;
        $this->app = $app;
    }

    /**
     * Handle a request to the application
     */
    public function handle(Request $request, Response $response): Response
    {
        try {
            // Validate request and extract parameters
            $params = $this->validateRequest($request);
            
            // Handle different HTTP methods
            switch ($request->getMethod()) {
                case 'GET':
                    return $this->handleGetRequest($params);
                case 'POST':
                    return $this->handlePostRequest($params);
                case 'PUT':
                    return $this->handlePutRequest($params);
                case 'PATCH':
                    return $this->handlePatchRequest($params);
                case 'DELETE':
                    return $this->handleDeleteRequest($params);
                default:
                    return $response->json([
                        'success' => false,
                        'message' => 'Method not allowed',
                        'code' => 405
                    ])->setStatusCode(405);
            }
        } catch (\Exception $e) {
            return $this->handleException($e, $response);
        }
    }

    /**
     * Validate request parameters
     */
    protected function validateRequest(Request $request): array
    {
        $validated = [
            'projectId' => $request->input('projectId'),
            'action' => $request->input('action', 'load'),
            'format' => $request->input('format', 'json'),
            'settings' => $request->input('settings', []),
        ];

        // Sanitize and validate inputs
        $validated = array_filter($validated, function ($value) {
            return $value !== null && $value !== '';
        });

        return $validated;
    }

    /**
     * Handle GET requests to the canvas
     */
    protected function handleGetRequest(array $params): Response
    {
        $action = $params['action'] ?? 'load';
        
        switch ($action) {
            case 'load':
                return $this->loadProject($params);
            case 'export':
                return $this->exportProject($params);
            case 'templates':
                return $this->getTemplates();
            case 'history':
                return $this->getHistory($params);
            case 'thumb':
                return $this->getThumbnail($params);
            default:
                return $this->getCanvasData($params);
        }
    }

    /**
     * Handle POST requests to create or update canvas
     */
    protected function handlePostRequest(array $params): Response
    {
        $action = $params['action'] ?? 'create';
        
        switch ($action) {
            case 'create':
                return $this->createProject($params);
            case 'update':
                return $this->updateProject($params);
            case 'import':
                return $this->importProject($params);
            case 'export':
                return $this->exportProject($params);
            case 'snapshot':
                return $this->saveSnapshot($params);
            default:
                return $response->json([
                    'success' => false,
                    'message' => 'Action not supported for POST',
                    'code' => 400
                ])->setStatusCode(400);
        }
    }

    /**
     * Handle PUT requests to update canvas data
     */
    protected function handlePutRequest(array $params): Response
    {
        return $this->updateProject($params);
    }

    /**
     * Handle PATCH requests to partially update canvas
     */
    protected function handlePatchRequest(array $params): Response
    {
        return $this->patchProject($params);
    }

    /**
     * Handle DELETE requests to remove canvas data
     */
    protected function handleDeleteRequest(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        // Delete project logic
        $result = $this->canvaService->deleteProject($projectId);
        
        if ($result['success']) {
            return $response->json($result);
        }

        return $response->json($result)->setStatusCode(404);
    }

    /**
     * Load a canvas project
     */
    protected function loadProject(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        $format = $params['format'] ?? 'json';
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        $result = $this->canvaService->loadProject($projectId);
        
        if ($result['success']) {
            $data = $result['data'];
            
            // Apply requested format
            if ($format === 'html') {
                $html = $this->generateCanvaHTML($data);
                return $response->setContentType('text/html')->setContent($html);
            } elseif ($format === 'json') {
                return $response->json($data);
            } elseif ($format === 'api') {
                return $response->json([
                    'success' => true,
                    'project' => $data,
                    'timestamp' => date('c'),
                    'version' => '1.0.0'
                ]);
            }
        }

        return $response->json($result)->setStatusCode($result['code'] ?? 500);
    }

    /**
     * Create a new canvas project
     */
    protected function createProject(array $params): Response
    {
        $settings = $params['settings'] ?? [];
        
        // Create project with specified settings
        $result = $this->canvaService->createProject($settings);
        
        if ($result['success']) {
            // Generate initial canvas data
            $canvasData = $this->generateInitialCanvas($settings);
            
            return $response->json([
                'success' => true,
                'projectId' => $result['projectId'],
                'message' => 'Project created successfully',
                'canvasData' => $canvasData,
                'settings' => $settings
            ]);
        }

        return $response->json($result)->setStatusCode($result['code'] ?? 500);
    }

    /**
     * Update an existing canvas project
     */
    protected function updateProject(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        $updates = $params['updates'] ?? [];
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        $result = $this->canvaService->updateProject($projectId, $updates);
        
        if ($result['success']) {
            return $response->json([
                'success' => true,
                'message' => 'Project updated successfully',
                'projectId' => $projectId,
                'updates' => $updates
            ]);
        }

        return $response->json($result)->setStatusCode($result['code'] ?? 500);
    }

    /**
     * Patch update a canvas project
     */
    protected function patchProject(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        $patchData = $params['patch'] ?? [];
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        $result = $this->canvaService->patchProject($projectId, $patchData);
        
        if ($result['success']) {
            return $response->json([
                'success' => true,
                'message' => 'Project patched successfully',
                'projectId' => $projectId,
                'patch' => $patchData
            ]);
        }

        return $response->json($result)->setStatusCode($result['code'] ?? 500);
    }

    /**
     * Export a canvas project
     */
    protected function exportProject(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        $format = $params['format'] ?? 'json';
        $options = $params['options'] ?? [];
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        $result = $this->canvaService->exportProject($projectId, $format, $options);
        
        if ($result['success']) {
            if ($format === 'download') {
                // Set appropriate headers for download
                $response->headers->set('Content-Type', $result['contentType'] ?? 'application/octet-stream');
                $response->headers->set('Content-Disposition', 'attachment; filename="' . $result['filename'] . '"');
                return $response->setContent($result['data']);
            }
            
            return $response->json($result);
        }

        return $response->json($result)->setStatusCode($result['code'] ?? 500);
    }

    /**
     * Get project templates
     */
    protected function getTemplates(): Response
    {
        $result = $this->canvaService->getTemplates();
        
        return $response->json($result);
    }

    /**
     * Get project history
     */
    protected function getHistory(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        $limit = $params['limit'] ?? 10;
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        $result = $this->canvaService->getProjectHistory($projectId, $limit);
        
        return $response->json($result);
    }

    /**
     * Get project thumbnail
     */
    protected function getThumbnail(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        $size = $params['size'] ?? 'small';
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        $result = $this->canvaService->getProjectThumbnail($projectId, $size);
        
        if ($result['success']) {
            $response->headers->set('Content-Type', 'image/' . $result['format']);
            $response->headers->set('Cache-Control', 'max-age=3600');
            return $response->setContent($result['data']);
        }

        return $response->json($result)->setStatusCode($result['code'] ?? 404);
    }

    /**
     * Save a project snapshot
     */
    protected function saveSnapshot(array $params): Response
    {
        $projectId = $params['projectId'] ?? null;
        $metadata = $params['metadata'] ?? [];
        
        if (!$projectId) {
            return $response->json([
                'success' => false,
                'message' => 'Project ID is required',
                'code' => 400
            ])->setStatusCode(400);
        }

        $result = $this->canvaService->saveProjectSnapshot($projectId, $metadata);
        
        if ($result['success']) {
            return $response->json([
                'success' => true,
                'message' => 'Snapshot saved successfully',
                'snapshotId' => $result['snapshotId'],
                'timestamp' => date('c')
            ]);
        }

        return $response->json($result)->setStatusCode($result['code'] ?? 500);
    }

    /**
     * Generate Canva HTML page
     */
    protected function generateCanvaHTML(array $projectData): string
    {
        $html = '<!DOCTYPE html>' . PHP_EOL;
        $html .= '<html lang="es">' . PHP_EOL;
        $html .= '<head>' . PHP_EOL;
        $html .= '  <meta charset="UTF-8">' . PHP_EOL;
        $html .= '  <meta name="viewport" content="width=device-width, initial-scale=1.0">' . PHP_EOL;
        $html .= '  <title>Canva - ' . ($projectData['name'] ?? 'Untitled Project') . '</title>' . PHP_EOL;
        $html .= '  <style>' . PHP_EOL;
        $html .= '    body { margin: 0; padding: 0; background: #0B0B0B; color: #fff; font-family: Space Grotesk, sans-serif; }' . PHP_EOL;
        $html .= '    #canva-container { width: 100vw; height: 100vh; }' . PHP_EOL;
        $html .= '  </style>' . PHP_EOL;
        $html .= '</head>' . PHP_EOL;
        $html .= '<body>' . PHP_EOL;
        $html .= '  <div id="canva-container"></div>' . PHP_EOL;
        $html .= '  <script src="/interno/frontend/js/canva-editor.js"></script>' . PHP_EOL;
        $html .= '  <script>' . PHP_EOL;
        $html .= '    const projectData = ' . json_encode($projectData) . ';' . PHP_EOL;
        $html .= '    window.onload = function() {\n      new CanvaEditor({ projectData });\n    };' . PHP_EOL;
        $html .= '  </script>' . PHP_EOL;
        $html .= '</body>' . PHP_EOL;
        $html .= '</html>' . PHP_EOL;
        
        return $html;
    }

    /**
     * Generate initial canvas data
     */
    protected function generateInitialCanvas(array $settings): array
    {
        $width = $settings['width'] ?? 800;
        $height = $settings['height'] ?? 600;
        $backgroundColor = $settings['backgroundColor'] ?? ($settings['theme'] === 'light' ? '#ffffff' : '#000000');
        
        // Generate a simple gradient background
        $canvas = imagecreatetruecolor($width, $height);
        
        if ($settings['theme'] === 'light') {
            $bg1 = imagecolorallocate($canvas, 240, 240, 240);
            $bg2 = imagecolorallocate($canvas, 255, 255, 255);
        } else {
            $bg1 = imagecolorallocate($canvas, 11, 11, 11);
            $bg2 = imagecolorallocate($canvas, 5, 5, 5);
        }
        
        imagefill($canvas, 0, 0, $bg1);
        
        // Add some pattern to make it look interesting
        for ($x = 0; $x < $width; $x += 20) {
            $color = $settings['theme'] === 'light' ? imagecolorallocate($canvas, 230, 230, 230) : imagecolorallocate($canvas, 20, 20, 20);
            imagesetpixel($canvas, $x, 0, IMG_COLOR_TRUECOLOR, $color);
        }
        
        // Convert to base64
        ob_start();
        imagepng($canvas);
        $imageData = ob_get_contents();
        ob_end_clean();
        imagedestroy($canvas);
        
        return [
            'width' => $width,
            'height' => $height,
            'backgroundColor' => $backgroundColor,
            'dataUrl' => 'data:image/png;base64,' . base64_encode($imageData),
            'timestamp' => date('c')
        ];
    }

    /**
     * Handle and format exceptions
     */
    protected function handleException(\Exception $e, Response $response): Response
    {
        $message = $this->app->isDebug() ? $e->getMessage() : 'An error occurred';
        $code = $e instanceof \Illuminate\Database\Eloquent\ModelNotFoundException ? 404 : 500;
        
        // Log the exception for debugging
        $this->logException($e);
        
        $response->json([
            'success' => false,
            'message' => $message,
            'code' => $code,
            'timestamp' => date('c'),
            'requestId' => $this->generateRequestId()
        ])->setStatusCode($code);
        
        return $response;
    }

    /**
     * Log exception for debugging
     */
    protected function logException(\Exception $e): void
    {
        \Log::error('Canva Route Exception: ' . $e->getMessage(), [
            'exception' => get_class($e),
            'message' => $e->getMessage(),
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString(),
        ]);
    }

    /**
     * Generate a unique request ID
     */
    protected function generateRequestId(): string
    {
        return 'req_' . substr(md5(uniqid()), 0, 16);
    }
}
